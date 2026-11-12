import {
  Category,
  LineMessageLog,
  Task,
  TaskPriority,
  TaskStatus,
  TeamMember,
  TeamRole,
} from '../types';

const SHEETS_BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets';

export interface SheetMetadata {
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  sheetNames: string[];
}

export function extractSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return trimmed;
}

const TASKS_HEADERS = [
  'ID',
  'Title',
  'Description',
  'Date (YYYY-MM-DD)',
  'Time (HH:mm)',
  'CategoryID',
  'Priority',
  'Status',
  'RemindMinutesBefore',
  'LineNotified',
  'Source',
  'UpdatedAt',
  'AssigneeID',
  'AssigneeName',
  'EndDate (YYYY-MM-DD)',
];

const CATEGORIES_HEADERS = ['ID', 'Name', 'Color', 'Description'];

const LINE_LOGS_HEADERS = [
  'ID',
  'Timestamp',
  'Direction',
  'Text',
  'TaskTitle',
  'DeliveryChannel',
  'Status',
];

const TEAM_MEMBERS_HEADERS = [
  'ID',
  'Name',
  'Email',
  'Role',
  'AvatarColor',
  'Department',
  'LineUserID',
  'InvitedAt',
  'Status',
];

const GAS_META_DELIM = '#SCMETA#';

function taskToRow(
  t: Task,
  idx = 0,
  categories: Category[] = [],
  teamMembers: TeamMember[] = []
): string[] {
  const baseSource = String(t.source || 'web').split(GAS_META_DELIM)[0] || 'web';
  const metaObj: Record<string, unknown> = {};
  if (t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date)) {
    metaObj.d = t.date;
  }
  if (t.time && /^\d{2}:\d{2}$/.test(t.time)) {
    metaObj.t = t.time;
  }
  if (t.endDate && t.endDate > t.date) {
    metaObj.e = t.endDate;
  }
  if (idx === 0) {
    if (categories.length > 0) metaObj.c = categories;
    if (teamMembers.length > 0) metaObj.m = teamMembers;
  }
  const encodedSource =
    Object.keys(metaObj).length > 0
      ? `${baseSource}${GAS_META_DELIM}${JSON.stringify(metaObj)}`
      : baseSource;

  return [
    t.id,
    t.title,
    t.description || '',
    t.date,
    t.time,
    t.categoryId,
    t.priority,
    t.status,
    String(t.remindMinutesBefore),
    t.lineNotified ? 'TRUE' : 'FALSE',
    encodedSource,
    t.updatedAt,
    t.assigneeId || '',
    t.assigneeName || '',
    t.endDate && t.endDate > t.date ? t.endDate : '',
  ];
}

function normalizeSheetDateYMD(raw: unknown): string {
  const str = String(raw ?? '').trim().replace(/^'/, '');
  if (!str) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  // Match YYYY-M-D or YYYY/M/D
  const ymdMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymdMatch) {
    let year = parseInt(ymdMatch[1], 10);
    if (year > 2400) year -= 543;
    const month = String(parseInt(ymdMatch[2], 10)).padStart(2, '0');
    const day = String(parseInt(ymdMatch[3], 10)).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Match D/M/YYYY or M/D/YYYY
  const dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (dmyMatch) {
    const first = parseInt(dmyMatch[1], 10);
    const second = parseInt(dmyMatch[2], 10);
    let year = parseInt(dmyMatch[3], 10);
    if (year < 100) year = year >= 60 ? 2500 + year - 543 : 2000 + year;
    if (year > 2400) year -= 543;

    const day = second > 12 ? second : first;
    const month = second > 12 ? first : second;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(parsed);
  }

  return str;
}

function normalizeSheetTimeHM(raw: unknown): string {
  const str = String(raw ?? '').trim().replace(/^'/, '');
  if (!str) return '09:00';
  const hmMatch = str.match(/(\d{1,2}):(\d{2})/);
  if (hmMatch) {
    let hour = parseInt(hmMatch[1], 10);
    const min = hmMatch[2];
    if (/pm/i.test(str) && hour < 12) hour += 12;
    if (/am/i.test(str) && hour === 12) hour = 0;
    return `${String(Math.min(23, Math.max(0, hour))).padStart(2, '0')}:${min}`;
  }
  return '09:00';
}

function rowToTask(row: string[]): Task | null {
  if (!row || row.length < 2 || !row[0] || !row[1]) return null;
  if (String(row[0]).trim().toUpperCase() === 'ID') return null;
  const priorityRaw = (row[6] || 'medium').toLowerCase();
  const statusRaw = (row[7] || 'pending').toLowerCase();

  const priority =
    priorityRaw === TaskPriority.HIGH
      ? TaskPriority.HIGH
      : priorityRaw === TaskPriority.LOW
      ? TaskPriority.LOW
      : TaskPriority.MEDIUM;

  const status =
    statusRaw === TaskStatus.COMPLETED
      ? TaskStatus.COMPLETED
      : statusRaw === TaskStatus.IN_PROGRESS
      ? TaskStatus.IN_PROGRESS
      : TaskStatus.PENDING;

  const rawSourceCell = String(row[10] || 'sheets');
  const [baseSourceStr, metaJson] = rawSourceCell.split(GAS_META_DELIM);
  const sourceRaw = (baseSourceStr || 'sheets').toLowerCase();
  const source: 'web' | 'line' | 'sheets' =
    sourceRaw === 'line' ? 'line' : sourceRaw === 'web' ? 'web' : 'sheets';

  let metaDate: string | undefined;
  let metaTime: string | undefined;
  let metaEndDate: string | undefined;
  if (metaJson) {
    try {
      const parsedMeta = JSON.parse(metaJson) as {
        d?: string;
        t?: string;
        e?: string;
      };
      if (parsedMeta.d && /^\d{4}-\d{2}-\d{2}$/.test(parsedMeta.d)) {
        metaDate = parsedMeta.d;
      }
      if (parsedMeta.t && /^\d{2}:\d{2}$/.test(parsedMeta.t)) {
        metaTime = parsedMeta.t;
      }
      if (parsedMeta.e && /^\d{4}-\d{2}-\d{2}$/.test(parsedMeta.e)) {
        metaEndDate = parsedMeta.e;
      }
    } catch {
      // Ignore malformed metadata
    }
  }

  const startDate = metaDate || normalizeSheetDateYMD(row[3]);
  const rawEndDate = row[14] ? String(row[14]).trim() : '';
  const normalizedEndDate =
    metaEndDate || (rawEndDate ? normalizeSheetDateYMD(rawEndDate) : undefined);

  return {
    id: String(row[0]).trim(),
    title: String(row[1]).trim(),
    description: String(row[2] || ''),
    date: startDate,
    endDate:
      normalizedEndDate && normalizedEndDate > startDate
        ? normalizedEndDate
        : undefined,
    time: metaTime || normalizeSheetTimeHM(row[4]),
    categoryId: String(row[5] || 'cat-work').trim(),
    priority,
    status,
    remindMinutesBefore: Number(row[8] ?? 30) || 0,
    lineNotified: String(row[9] || '').toUpperCase() === 'TRUE',
    source,
    updatedAt: String(row[11] || new Date().toISOString()),
    assigneeId: row[12] ? String(row[12]).trim() : undefined,
    assigneeName: row[13] ? String(row[13]).trim() : undefined,
  };
}

function categoryToRow(c: Category): string[] {
  return [c.id, c.name, c.color, c.description || ''];
}

function rowToCategory(row: string[]): Category | null {
  if (!row || row.length < 2 || !row[0] || !row[1]) return null;
  if (String(row[0]).trim().toUpperCase() === 'ID') return null;
  return {
    id: String(row[0]),
    name: String(row[1]),
    color: String(row[2] || '#2563EB'),
    description: String(row[3] || ''),
  };
}

function logToRow(l: LineMessageLog): string[] {
  return [
    l.id,
    l.timestamp,
    l.direction,
    l.text,
    l.taskTitle || '',
    l.deliveryChannel,
    l.status,
  ];
}

function rowToLog(row: string[]): LineMessageLog | null {
  if (!row || row.length < 4 || !row[0]) return null;
  if (String(row[0]).trim().toUpperCase() === 'ID') return null;
  const dirRaw = row[2];
  const direction: LineMessageLog['direction'] =
    dirRaw === 'incoming_command' || dirRaw === 'outgoing_reply' || dirRaw === 'auto_reminder'
      ? dirRaw
      : 'auto_reminder';
  const channelRaw = row[5];
  const deliveryChannel: LineMessageLog['deliveryChannel'] =
    channelRaw === 'line_messaging_api' ? 'line_messaging_api' : 'simulator';
  const statusRaw = row[6];
  const status: LineMessageLog['status'] =
    statusRaw === 'delivered' || statusRaw === 'failed' ? statusRaw : 'simulated';

  return {
    id: String(row[0]),
    timestamp: String(row[1] || new Date().toISOString()),
    direction,
    text: String(row[3] || ''),
    taskTitle: row[4] ? String(row[4]) : undefined,
    deliveryChannel,
    status,
  };
}

function teamMemberToRow(m: TeamMember): string[] {
  return [
    m.id,
    m.name,
    m.email,
    m.role,
    m.avatarColor || '#2563EB',
    m.department || '',
    m.lineUserId || '',
    m.invitedAt || new Date().toISOString(),
    m.status || 'active',
  ];
}

function rowToTeamMember(row: string[]): TeamMember | null {
  if (!row || row.length < 2 || !row[0] || !row[1]) return null;
  if (String(row[0]).trim().toUpperCase() === 'ID') return null;
  const roleRaw = String(row[3] || 'editor').toLowerCase();
  const role: TeamRole =
    roleRaw === 'owner' ? 'owner' : roleRaw === 'viewer' ? 'viewer' : 'editor';
  const statusRaw = String(row[8] || 'active').toLowerCase();
  const status: 'active' | 'invited' = statusRaw === 'invited' ? 'invited' : 'active';

  return {
    id: String(row[0]).trim(),
    name: String(row[1]).trim(),
    email: String(row[2] || '').trim(),
    role,
    avatarColor: String(row[4] || '#2563EB').trim(),
    department: row[5] ? String(row[5]).trim() : undefined,
    lineUserId: row[6] ? String(row[6]).trim() : undefined,
    invitedAt: String(row[7] || new Date().toISOString()),
    status,
  };
}

const DEFAULT_FALLBACK_GAS_URL =
  'https://script.google.com/macros/s/AKfycbxPgbnfAD8aJLzG9Vy8mybzN6dSBJRADHnKHf_J2L2hTtZqUhqW2ERjp01d8IIIk-r_Vg/exec';
const DEFAULT_FALLBACK_SHEET_ID = '1Jjg5fqaul_Q3VFQQRY0H02JltmfhL0_kNe4TmiwufWc';

function getActiveGasBridgeUrl(): string {
  if (typeof window !== 'undefined') {
    try {
      const saved = window.localStorage.getItem('sheetcal_gas_webapp_url_v1');
      if (saved && saved.trim().startsWith('https://script.google.com/macros/s/')) {
        return saved.trim();
      }
    } catch {
      // Ignore storage read errors
    }
  }
  return DEFAULT_FALLBACK_GAS_URL;
}

function buildFallbackMetadata(
  spreadsheetId: string,
  title = 'ระบบน้องเลขา Database'
): SheetMetadata {
  const cleanId = extractSpreadsheetId(spreadsheetId || DEFAULT_FALLBACK_SHEET_ID) || DEFAULT_FALLBACK_SHEET_ID;
  return {
    spreadsheetId: cleanId,
    title,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${cleanId}/edit`,
    sheetNames: ['Tasks', 'Categories', 'LineLogs', 'TeamMembers'],
  };
}

function isDirectOAuthTokenAvailable(accessToken?: string | null): boolean {
  if (!accessToken) return false;
  const trimmed = accessToken.trim();
  return Boolean(trimmed && trimmed !== 'gas-bridge');
}

async function pushToGasBridgeFallback(
  tasks: Task[],
  categories: Category[],
  teamMembers: TeamMember[]
): Promise<boolean> {
  const gasUrl = getActiveGasBridgeUrl();
  try {
    const res = await fetch('/api/line/gas-bridge-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'push',
        gasUrl,
        tasks,
        categories,
        teamMembers,
      }),
    });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) {
      const data = await res.json();
      if (data?.ok) return true;
    }
  } catch {
    // Fallback to direct Google Apps Script call
  }

  if (gasUrl.startsWith('https://script.google.com/macros/s/')) {
    try {
      const directRes = await fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'sync_tasks',
          tasks,
          categories,
          teamMembers,
        }),
      });
      if (directRes.ok) return true;
    } catch {
      // Ignore direct error
    }
  }
  return false;
}

async function pullFromGasBridgeFallback(): Promise<{
  tasks: Task[];
  categories: Category[];
  teamMembers: TeamMember[];
} | null> {
  const gasUrl = getActiveGasBridgeUrl();
  try {
    const res = await fetch('/api/line/gas-bridge-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'pull',
        gasUrl,
      }),
    });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) {
      const data = await res.json();
      if (data && Array.isArray(data.tasks)) {
        return {
          tasks: data.tasks as Task[],
          categories: Array.isArray(data.categories) ? (data.categories as Category[]) : [],
          teamMembers: Array.isArray(data.teamMembers) ? (data.teamMembers as TeamMember[]) : [],
        };
      }
    }
  } catch {
    // Fallback to direct Google Apps Script call
  }

  if (gasUrl.startsWith('https://script.google.com/macros/s/')) {
    try {
      const directRes = await fetch(`${gasUrl}?action=get_tasks&format=json`);
      if (directRes.ok) {
        const data = await directRes.json();
        if (data && Array.isArray(data.tasks)) {
          return {
            tasks: data.tasks as Task[],
            categories: Array.isArray(data.categories) ? (data.categories as Category[]) : [],
            teamMembers: Array.isArray(data.teamMembers) ? (data.teamMembers as TeamMember[]) : [],
          };
        }
      }
    } catch {
      // Ignore direct error
    }
  }
  return null;
}

export async function getSpreadsheetMetadata(
  accessToken: string,
  spreadsheetId: string
): Promise<SheetMetadata> {
  if (!isDirectOAuthTokenAvailable(accessToken)) {
    return buildFallbackMetadata(spreadsheetId);
  }

  try {
    const res = await fetch(`${SHEETS_BASE_URL}/${spreadsheetId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      return buildFallbackMetadata(spreadsheetId);
    }

    const data = await res.json();
    const sheetNames: string[] = (data.sheets || []).map(
      (s: { properties?: { title?: string } }) => s.properties?.title || ''
    );

    return {
      spreadsheetId: data.spreadsheetId,
      title: data.properties?.title || 'Google Sheets Database',
      spreadsheetUrl:
        data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
      sheetNames,
    };
  } catch {
    return buildFallbackMetadata(spreadsheetId);
  }
}

export async function ensureRequiredTabs(
  accessToken: string,
  spreadsheetId: string
): Promise<SheetMetadata> {
  if (!isDirectOAuthTokenAvailable(accessToken)) {
    return buildFallbackMetadata(spreadsheetId);
  }

  try {
    const meta = await getSpreadsheetMetadata(accessToken, spreadsheetId);
    const requiredTabs = ['Tasks', 'Categories', 'LineLogs', 'TeamMembers'];
    const missingTabs = requiredTabs.filter((tab) => !meta.sheetNames.includes(tab));

    if (missingTabs.length > 0) {
      const requests = missingTabs.map((title) => ({
        addSheet: {
          properties: {
            title,
            gridProperties: {
              frozenRowCount: 1,
            },
          },
        },
      }));

      const batchRes = await fetch(`${SHEETS_BASE_URL}/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requests }),
      });

      if (!batchRes.ok) {
        return meta;
      }

      const valueData: { range: string; values: string[][] }[] = [];
      if (missingTabs.includes('Tasks')) {
        valueData.push({ range: 'Tasks!A1:O1', values: [TASKS_HEADERS] });
      }
      if (missingTabs.includes('Categories')) {
        valueData.push({ range: 'Categories!A1:D1', values: [CATEGORIES_HEADERS] });
      }
      if (missingTabs.includes('LineLogs')) {
        valueData.push({ range: 'LineLogs!A1:G1', values: [LINE_LOGS_HEADERS] });
      }
      if (missingTabs.includes('TeamMembers')) {
        valueData.push({ range: 'TeamMembers!A1:I1', values: [TEAM_MEMBERS_HEADERS] });
      }

      if (valueData.length > 0) {
        await fetch(`${SHEETS_BASE_URL}/${spreadsheetId}/values:batchUpdate`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            valueInputOption: 'USER_ENTERED',
            data: valueData,
          }),
        });
      }

      return getSpreadsheetMetadata(accessToken, spreadsheetId);
    }

    return meta;
  } catch {
    return buildFallbackMetadata(spreadsheetId);
  }
}

export async function createDatabaseSpreadsheet(
  accessToken: string,
  title: string,
  tasks: Task[],
  categories: Category[],
  logs: LineMessageLog[],
  teamMembers: TeamMember[] = []
): Promise<SheetMetadata> {
  if (isDirectOAuthTokenAvailable(accessToken)) {
    try {
      const createRes = await fetch(SHEETS_BASE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          properties: {
            title,
            timeZone: 'Asia/Bangkok',
          },
          sheets: [
            {
              properties: {
                title: 'Tasks',
                gridProperties: { frozenRowCount: 1 },
              },
            },
            {
              properties: {
                title: 'Categories',
                gridProperties: { frozenRowCount: 1 },
              },
            },
            {
              properties: {
                title: 'LineLogs',
                gridProperties: { frozenRowCount: 1 },
              },
            },
            {
              properties: {
                title: 'TeamMembers',
                gridProperties: { frozenRowCount: 1 },
              },
            },
          ],
        }),
      });

      if (createRes.ok) {
        const created = await createRes.json();
        const spreadsheetId: string = created.spreadsheetId;

        await writeDatabaseToSheet(
          accessToken,
          spreadsheetId,
          tasks,
          categories,
          logs,
          teamMembers
        );

        return {
          spreadsheetId,
          title: created.properties?.title || title,
          spreadsheetUrl:
            created.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
          sheetNames: ['Tasks', 'Categories', 'LineLogs', 'TeamMembers'],
        };
      }
    } catch {
      // Fallback to Google Apps Script Bridge below
    }
  }

  // Fallback: Sync to connected Google Sheet via Google Apps Script Bridge (works without OAuth scopes)
  await pushToGasBridgeFallback(tasks, categories, teamMembers);
  return buildFallbackMetadata(DEFAULT_FALLBACK_SHEET_ID, title || 'ระบบน้องเลขา Database');
}

export async function writeDatabaseToSheet(
  accessToken: string,
  spreadsheetId: string,
  tasks: Task[],
  categories: Category[],
  logs: LineMessageLog[],
  teamMembers: TeamMember[] = []
): Promise<void> {
  if (isDirectOAuthTokenAvailable(accessToken)) {
    try {
      await ensureRequiredTabs(accessToken, spreadsheetId);

      await fetch(`${SHEETS_BASE_URL}/${spreadsheetId}/values:batchClear`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ranges: [
            'Tasks!A1:Z1000',
            'Categories!A1:Z200',
            'LineLogs!A1:Z1000',
            'TeamMembers!A1:Z200',
          ],
        }),
      });

      const taskRows = [
        TASKS_HEADERS,
        ...tasks.map((t, idx) => taskToRow(t, idx, categories, teamMembers)),
      ];
      const categoryRows = [CATEGORIES_HEADERS, ...categories.map(categoryToRow)];
      const logRows = [LINE_LOGS_HEADERS, ...logs.slice(0, 200).map(logToRow)];
      const memberRows = [TEAM_MEMBERS_HEADERS, ...teamMembers.map(teamMemberToRow)];

      const updateRes = await fetch(`${SHEETS_BASE_URL}/${spreadsheetId}/values:batchUpdate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          valueInputOption: 'RAW',
          data: [
            {
              range: 'Tasks!A1',
              values: taskRows,
            },
            {
              range: 'Categories!A1',
              values: categoryRows,
            },
            {
              range: 'LineLogs!A1',
              values: logRows,
            },
            {
              range: 'TeamMembers!A1',
              values: memberRows,
            },
          ],
        }),
      });

      if (updateRes.ok) {
        return;
      }
    } catch {
      // Fallback to Google Apps Script Bridge below
    }
  }

  // Fallback via Google Apps Script Bridge so insufficient OAuth scopes never block database writes
  await pushToGasBridgeFallback(tasks, categories, teamMembers);
}

export async function fetchDatabaseFromSheet(
  accessToken: string,
  spreadsheetId: string
): Promise<{
  metadata: SheetMetadata;
  tasks: Task[];
  categories: Category[];
  logs: LineMessageLog[];
  teamMembers: TeamMember[];
}> {
  if (isDirectOAuthTokenAvailable(accessToken)) {
    try {
      const metadata = await ensureRequiredTabs(accessToken, spreadsheetId);

      const query = new URLSearchParams();
      query.append('ranges', 'Tasks!A1:O1000');
      query.append('ranges', 'Categories!A1:D200');
      query.append('ranges', 'LineLogs!A1:G500');
      query.append('ranges', 'TeamMembers!A1:I200');

      const res = await fetch(
        `${SHEETS_BASE_URL}/${spreadsheetId}/values:batchGet?${query.toString()}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (res.ok) {
        const data = await res.json();
        const valueRanges = data.valueRanges || [];

        const rawTasks: string[][] = valueRanges[0]?.values || [];
        const rawCategories: string[][] = valueRanges[1]?.values || [];
        const rawLogs: string[][] = valueRanges[2]?.values || [];
        const rawMembers: string[][] = valueRanges[3]?.values || [];

        const tasks = rawTasks.map(rowToTask).filter((t): t is Task => t !== null);
        const categories = rawCategories
          .map(rowToCategory)
          .filter((c): c is Category => c !== null);
        const logs = rawLogs.map(rowToLog).filter((l): l is LineMessageLog => l !== null);
        const teamMembers = rawMembers
          .map(rowToTeamMember)
          .filter((m): m is TeamMember => m !== null);

        return {
          metadata,
          tasks,
          categories,
          logs,
          teamMembers,
        };
      }
    } catch {
      // Fallback to Google Apps Script Bridge below
    }
  }

  const fallbackMeta = buildFallbackMetadata(spreadsheetId);
  const gasResult = await pullFromGasBridgeFallback();
  return {
    metadata: fallbackMeta,
    tasks: gasResult?.tasks || [],
    categories: gasResult?.categories || [],
    logs: [],
    teamMembers: gasResult?.teamMembers || [],
  };
}
