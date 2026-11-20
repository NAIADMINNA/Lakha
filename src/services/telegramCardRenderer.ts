import {
  FlexDigestItem,
  Task,
  TaskPriority,
  TaskStatus,
  TelegramTemplateStyle,
} from '../types';
import {
  formatSummaryCardHeaderDate,
  formatTaskDateRangeLabel,
  formatThaiDateDisplay,
} from './lineCommandParser';
import { DEFAULT_TELEGRAM_HEADER_TITLE } from './telegramService';

export interface TelegramCardTypographyOptions {
  cardFontSize?: 'sm' | 'md' | 'lg';
  cardTitleWeight?: 'bold' | 'regular';
  cardLineSpacing?: 'tight' | 'normal' | 'relaxed';
}

export interface TelegramCardStyleOptions extends TelegramCardTypographyOptions {
  style?: TelegramTemplateStyle;
  headerTitle?: string;
  showStats?: boolean;
}

const FONT_SANS = '"Noto Sans Thai", "Plus Jakarta Sans", system-ui, -apple-system, sans-serif';
const FONT_MONO = '"JetBrains Mono", "Noto Sans Thai", monospace';

let thaiSegmenterCache: Intl.Segmenter | null | undefined;

function segmentThaiWords(text: string): string[] {
  if (thaiSegmenterCache === undefined) {
    try {
      thaiSegmenterCache =
        typeof Intl !== 'undefined' && 'Segmenter' in Intl
          ? new Intl.Segmenter('th', { granularity: 'word' })
          : null;
    } catch {
      thaiSegmenterCache = null;
    }
  }
  if (thaiSegmenterCache) {
    return Array.from(thaiSegmenterCache.segment(text), (s) => s.segment);
  }
  return text.split(/(\s+)/);
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 12
): string[] {
  const clean = String(text || '').replace(/\r\n/g, '\n');
  if (!clean.trim()) return [];

  const paragraphs = clean.split('\n');
  const result: string[] = [];

  for (const para of paragraphs) {
    if (result.length >= maxLines) break;
    if (!para.trim()) {
      if (result.length > 0 && result[result.length - 1] !== '') {
        result.push('');
      }
      continue;
    }

    const tokens = segmentThaiWords(para);
    let current = '';

    for (const token of tokens) {
      const candidate = current + token;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        if (current.trim()) {
          result.push(current.trimEnd());
          if (result.length >= maxLines) break;
          current = token.trimStart();
        } else {
          let charAcc = '';
          for (const ch of Array.from(token)) {
            if (ctx.measureText(charAcc + ch).width <= maxWidth) {
              charAcc += ch;
            } else {
              if (charAcc) result.push(charAcc);
              if (result.length >= maxLines) break;
              charAcc = ch;
            }
          }
          current = charAcc;
        }
      }
    }

    if (result.length < maxLines && current.trim()) {
      result.push(current.trimEnd());
    }
  }

  if (result.length === maxLines) {
    const last = result[maxLines - 1];
    if (last && ctx.measureText(last).width > maxWidth - 20) {
      let trimmed = last;
      while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
        trimmed = trimmed.slice(0, -1);
      }
      result[maxLines - 1] = `${trimmed}…`;
    }
  }

  return result;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | { tl: number; tr: number; br: number; bl: number }
) {
  const rad =
    typeof r === 'number'
      ? { tl: r, tr: r, br: r, bl: r }
      : { tl: r.tl, tr: r.tr, br: r.br, bl: r.bl };
  ctx.beginPath();
  ctx.moveTo(x + rad.tl, y);
  ctx.lineTo(x + w - rad.tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad.tr);
  ctx.lineTo(x + w, y + h - rad.br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad.br, y + h);
  ctx.lineTo(x + rad.bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad.bl);
  ctx.lineTo(x, y + rad.tl);
  ctx.quadraticCurveTo(x, y, x + rad.tl, y);
  ctx.closePath();
}

function getFontMetrics(opts?: TelegramCardTypographyOptions) {
  // Generous mobile-first sizing: even 'md' is large and readable inside Telegram chat bubbles
  const sizeOffset = opts?.cardFontSize === 'sm' ? -3 : opts?.cardFontSize === 'lg' ? 4 : 0;
  const titleWeight = opts?.cardTitleWeight === 'regular' ? 600 : 700;
  const lineRatio =
    opts?.cardLineSpacing === 'tight' ? 1.24 : opts?.cardLineSpacing === 'normal' ? 1.36 : 1.46;
  return { sizeOffset, titleWeight, lineRatio };
}

function getPriorityTheme(priority: TaskPriority | string) {
  if (priority === TaskPriority.HIGH || priority === 'high') {
    return {
      label: 'ด่วนมาก',
      shortLabel: 'ด่วนมาก',
      badgeBg: '#DC2626',
      badgeText: '#FFFFFF',
      dot: '#EF4444',
    };
  }
  if (priority === TaskPriority.LOW || priority === 'low') {
    return {
      label: 'ตามกำหนดการ',
      shortLabel: 'ทั่วไป',
      badgeBg: '#1E3A5F',
      badgeText: '#FFFFFF',
      dot: '#10B981',
    };
  }
  return {
    label: 'สำคัญปานกลาง',
    shortLabel: 'ปานกลาง',
    badgeBg: '#D97706',
    badgeText: '#FFFFFF',
    dot: '#F59E0B',
  };
}

function getStatusTheme(status: TaskStatus | string) {
  if (status === TaskStatus.COMPLETED || status === 'completed') {
    return { label: 'เสร็จสิ้นแล้ว', bg: '#DCFCE7', text: '#15803D', dot: '#10B981' };
  }
  if (status === TaskStatus.IN_PROGRESS || status === 'in_progress') {
    return { label: 'กำลังดำเนินการ', bg: '#DBEAFE', text: '#1D4ED8', dot: '#3B82F6' };
  }
  return { label: 'รอดำเนินการ', bg: '#FEF3C7', text: '#B45309', dot: '#F59E0B' };
}

async function ensureCanvasFontsLoaded() {
  if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
    try {
      await Promise.race([
        document.fonts.ready,
        new Promise((resolve) => setTimeout(resolve, 1200)),
      ]);
    } catch {
      // Proceed with fallback system fonts
    }
  }
}

function createCanvasPair(width: number, height: number) {
  if (typeof document === 'undefined') return null;
  const dpr = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  ctx.textBaseline = 'top';
  return { canvas, ctx };
}

function drawPill(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  bgColor: string,
  textColor: string,
  fontSize = 17,
  weight = 700,
  fontFamily = FONT_SANS,
  padX = 14,
  padY = 6
): { width: number; height: number } {
  ctx.font = `${weight} ${fontSize}px ${fontFamily}`;
  const textW = ctx.measureText(text).width;
  const h = fontSize + padY * 2 + 2;
  const w = textW + padX * 2;
  drawRoundedRect(ctx, x, y, w, h, 9);
  ctx.fillStyle = bgColor;
  ctx.fill();
  ctx.fillStyle = textColor;
  ctx.fillText(text, x + padX, y + padY + 1);
  return { width: w, height: h };
}

function drawKpiStrip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  stats: { total: number; pending: number; completed: number },
  darkTheme: boolean
): number {
  const h = 84;
  drawRoundedRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = darkTheme ? '#132640' : '#F8FAFC';
  ctx.fill();
  if (!darkTheme) {
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  const colW = w / 3;
  const items = [
    {
      label: 'ทั้งหมด',
      value: String(stats.total),
      color: darkTheme ? '#FFFFFF' : '#0F172A',
    },
    {
      label: 'รอดำเนินการ',
      value: String(stats.pending),
      color: darkTheme ? '#FBBF24' : '#D97706',
    },
    {
      label: 'เสร็จสิ้นแล้ว',
      value: String(stats.completed),
      color: darkTheme ? '#34D399' : '#059669',
    },
  ];

  items.forEach((item, idx) => {
    const cx = x + colW * idx + colW / 2;
    if (idx > 0) {
      ctx.strokeStyle = darkTheme ? '#1E3A5F' : '#E2E8F0';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + colW * idx, y + 16);
      ctx.lineTo(x + colW * idx, y + h - 16);
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.font = `700 31px ${FONT_MONO}`;
    ctx.fillStyle = item.color;
    ctx.fillText(item.value, cx, y + 12);

    ctx.font = `600 16px ${FONT_SANS}`;
    ctx.fillStyle = darkTheme ? '#CBD5E1' : '#475569';
    ctx.fillText(item.label, cx, y + 52);
  });

  ctx.textAlign = 'left';
  return h;
}

export async function renderSingleTaskTelegramCardPng(params: {
  task: Task;
  categoryName: string;
  categoryColor?: string;
  remindLabel: string;
  includeDescription?: boolean;
  summaryStats?: { total: number; pending: number; completed: number };
  isManualTrigger?: boolean;
  format?: TelegramCardStyleOptions;
}): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  await ensureCanvasFontsLoaded();

  const {
    task,
    categoryName,
    categoryColor = '#0284C7',
    remindLabel,
    includeDescription = true,
    summaryStats,
    format,
  } = params;

  const style: TelegramTemplateStyle = format?.style || 'executive_card';
  const headerTitle = (format?.headerTitle || DEFAULT_TELEGRAM_HEADER_TITLE).trim();
  const showStats = format?.showStats !== false && Boolean(summaryStats);
  const { sizeOffset, titleWeight, lineRatio } = getFontMetrics(format);

  const prio = getPriorityTheme(task.priority);
  const status = getStatusTheme(task.status);
  const dateRange = formatTaskDateRangeLabel(task, 'long');
  const fullHeaderDate = formatSummaryCardHeaderDate(task.date, [task]);
  const timeText = `${(task.time || '09:00').trim()} น.`;
  const cleanDesc = includeDescription && task.description?.trim() ? task.description.trim() : '';
  const cleanAssignee = task.assigneeName?.trim() || '';

  // Mobile-first compact canvas width (540px logical @ 2x DPR = 1080px crisp PNG)
  // so text stays BIG and readable inside phone Telegram chat bubbles!
  const outerPad = 8;
  const cardW = 540;
  const totalW = cardW + outerPad * 2;
  const innerPad = 24;
  const contentW = cardW - innerPad * 2;

  const measurePair = createCanvasPair(totalW, 200);
  if (!measurePair) return null;
  const mctx = measurePair.ctx;

  const eyebrowSize = 17 + Math.min(2, Math.max(-2, sizeOffset));
  const titleFontSize = (style === 'compact_brief' ? 28 : 32) + sizeOffset;
  const titleLineH = Math.round(titleFontSize * lineRatio);
  mctx.font = `${titleWeight} ${titleFontSize}px ${FONT_SANS}`;
  const titleMaxW = style === 'timeline_digest' ? contentW - 134 : contentW;
  const titleLines = wrapTextLines(mctx, task.title || 'กำหนดการ', titleMaxW, 4);

  const subFontSize = 19 + Math.min(2, Math.max(-2, sizeOffset));
  const subLineH = Math.round(subFontSize * 1.35);
  mctx.font = `500 ${subFontSize}px ${FONT_SANS}`;
  const subMaxW = style === 'timeline_digest' ? contentW - 134 : contentW;
  const headerSubText =
    style === 'timeline_digest'
      ? `${fullHeaderDate}`
      : `${fullHeaderDate} · เวลา ${timeText}`;
  const headerSubLines =
    style === 'compact_brief' ? [] : wrapTextLines(mctx, headerSubText, subMaxW, 2);

  // Measure detail rows (with wrapping so nothing ever clips!)
  const labelFontSize = 18 + Math.min(2, Math.max(-2, sizeOffset));
  const valueFontSize = 21 + Math.min(3, Math.max(-2, sizeOffset));
  const valueLineH = Math.round(valueFontSize * 1.32);
  const labelColW = 128;
  const valueColW = contentW - labelColW;

  type DetailSpec = {
    label: string;
    valueLines: string[];
    dotColor?: string;
    pillBg?: string;
    pillText?: string;
    mono?: boolean;
    extraLines?: string[];
    height: number;
  };

  const detailSpecs: DetailSpec[] = [];

  // 1. Date
  mctx.font = `700 ${valueFontSize}px ${FONT_SANS}`;
  const dateLines = wrapTextLines(mctx, dateRange, valueColW, 2);
  detailSpecs.push({
    label: 'วันที่',
    valueLines: dateLines,
    height: Math.max(50, dateLines.length * valueLineH + 22),
  });

  // 2. Time + remind note
  const remindFontSize = 17 + Math.min(2, Math.max(-2, sizeOffset));
  mctx.font = `500 ${remindFontSize}px ${FONT_SANS}`;
  const remindNoteLines = remindLabel
    ? wrapTextLines(mctx, remindLabel, valueColW, 2)
    : [];
  detailSpecs.push({
    label: 'เวลา',
    valueLines: [timeText],
    pillBg: '#E0F2FE',
    pillText: '#0369A1',
    mono: true,
    extraLines: remindNoteLines,
    height: 44 + (remindNoteLines.length > 0 ? remindNoteLines.length * Math.round(remindFontSize * 1.32) + 8 : 0) + 12,
  });

  // 3. Category
  mctx.font = `700 ${valueFontSize}px ${FONT_SANS}`;
  const catLines = wrapTextLines(mctx, categoryName, valueColW - 22, 2);
  detailSpecs.push({
    label: 'หมวดหมู่',
    valueLines: catLines,
    dotColor: categoryColor,
    height: Math.max(50, catLines.length * valueLineH + 22),
  });

  // 4. Status
  detailSpecs.push({
    label: 'สถานะ',
    valueLines: [status.label],
    pillBg: status.bg,
    pillText: status.text,
    dotColor: status.dot,
    height: 54,
  });

  // 5. Assignee (optional)
  if (cleanAssignee) {
    mctx.font = `700 ${valueFontSize}px ${FONT_SANS}`;
    const assigneeLines = wrapTextLines(mctx, cleanAssignee, valueColW, 2);
    detailSpecs.push({
      label: 'ผู้รับผิดชอบ',
      valueLines: assigneeLines,
      height: Math.max(50, assigneeLines.length * valueLineH + 22),
    });
  }

  // Description box measure
  const descFontSize = 20 + Math.min(3, Math.max(-2, sizeOffset));
  const descLineH = Math.round(descFontSize * lineRatio);
  mctx.font = `500 ${descFontSize}px ${FONT_SANS}`;
  const descLines = cleanDesc ? wrapTextLines(mctx, cleanDesc, contentW - 36, 8) : [];
  const descBoxH = descLines.length > 0 ? 50 + descLines.length * descLineH + 18 : 0;

  // Header height
  const headerTopPad = style === 'compact_brief' ? 22 : 26;
  const eyebrowH = 34;
  const titleBlockH = Math.max(1, titleLines.length) * titleLineH;
  const subBlockH = headerSubLines.length * subLineH;
  const kpiHeaderH = showStats && style === 'executive_card' ? 84 + 18 : 0;
  const headerH =
    style === 'compact_brief'
      ? headerTopPad + eyebrowH + 12 + titleBlockH + 20
      : style === 'timeline_digest'
      ? headerTopPad + eyebrowH + 14 + Math.max(92, titleBlockH + 8 + subBlockH) + 24
      : headerTopPad + eyebrowH + 12 + titleBlockH + 10 + subBlockH + kpiHeaderH + 24;

  const rowsTotalH = detailSpecs.reduce((sum, r) => sum + r.height, 0);
  const bodyKpiH = showStats && style !== 'executive_card' ? 84 + 18 : 0;
  const footerH = 50;

  const bodyH =
    20 +
    rowsTotalH +
    (descBoxH > 0 ? 14 + descBoxH : 0) +
    (bodyKpiH > 0 ? 18 + bodyKpiH : 0) +
    20;

  const cardH = headerH + bodyH + footerH;
  const totalH = cardH + outerPad * 2;

  const pair = createCanvasPair(totalW, totalH);
  if (!pair) return null;
  const { canvas, ctx } = pair;

  // Clean subtle neutral frame
  ctx.fillStyle = '#CBD5E1';
  ctx.fillRect(0, 0, totalW, totalH);

  // Outer card surface
  drawRoundedRect(ctx, outerPad, outerPad, cardW, cardH, 20);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  ctx.save();
  drawRoundedRect(ctx, outerPad, outerPad, cardW, cardH, 20);
  ctx.clip();

  const cx = outerPad + innerPad;
  let y = outerPad;

  // Helper to clip eyebrow text cleanly next to top-right badge
  const drawHeaderTopRow = (eyebrowColor: string, prioText: string) => {
    ctx.font = `700 16px ${FONT_SANS}`;
    const prioW = ctx.measureText(prioText).width + 26;
    drawPill(
      ctx,
      prioText,
      outerPad + cardW - innerPad - prioW,
      y + headerTopPad - 3,
      prio.badgeBg,
      prio.badgeText,
      16,
      700,
      FONT_SANS,
      13,
      5
    );

    ctx.font = `700 ${eyebrowSize}px ${FONT_SANS}`;
    ctx.fillStyle = eyebrowColor;
    const availEyebrowW = contentW - prioW - 12;
    const clippedEyebrow = wrapTextLines(mctx, headerTitle, availEyebrowW, 1)[0] || headerTitle;
    ctx.fillText(clippedEyebrow, cx, y + headerTopPad + 2);
  };

  // === HEADER ===
  if (style === 'compact_brief') {
    ctx.fillStyle = prio.badgeBg;
    ctx.fillRect(outerPad, y, cardW, 8);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(outerPad, y + 8, cardW, headerH - 8);

    drawHeaderTopRow('#475569', prio.shortLabel);

    let ty = y + headerTopPad + eyebrowH + 12;
    ctx.font = `${titleWeight} ${titleFontSize}px ${FONT_SANS}`;
    ctx.fillStyle = '#0F172A';
    for (const line of titleLines) {
      ctx.fillText(line, cx, ty);
      ty += titleLineH;
    }

    ctx.fillStyle = '#E2E8F0';
    ctx.fillRect(outerPad, y + headerH - 1, cardW, 1.5);
  } else if (style === 'timeline_digest') {
    const grad = ctx.createLinearGradient(outerPad, y, outerPad + cardW, y + headerH);
    grad.addColorStop(0, '#0F172A');
    grad.addColorStop(1, '#1E3A8A');
    ctx.fillStyle = grad;
    ctx.fillRect(outerPad, y, cardW, headerH);

    drawHeaderTopRow('#93C5FD', prio.shortLabel);

    const blockY = y + headerTopPad + eyebrowH + 14;
    const timeBoxH = Math.max(88, titleBlockH + 8 + subBlockH);
    drawRoundedRect(ctx, cx, blockY, 118, timeBoxH, 14);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(147, 197, 253, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = `700 28px ${FONT_MONO}`;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText((task.time || '09:00').trim(), cx + 59, blockY + 18);
    ctx.font = `600 15px ${FONT_SANS}`;
    ctx.fillStyle = '#BFDBFE';
    ctx.fillText('น. เริ่มงาน', cx + 59, blockY + 54);
    ctx.textAlign = 'left';

    let ty = blockY;
    ctx.font = `${titleWeight} ${titleFontSize}px ${FONT_SANS}`;
    ctx.fillStyle = '#FFFFFF';
    for (const line of titleLines) {
      ctx.fillText(line, cx + 134, ty);
      ty += titleLineH;
    }

    ctx.font = `500 ${subFontSize}px ${FONT_SANS}`;
    ctx.fillStyle = '#CBD5E1';
    let sy = ty + 6;
    for (const sLine of headerSubLines) {
      ctx.fillText(sLine, cx + 134, sy);
      sy += subLineH;
    }
  } else {
    // Executive Royal Navy Card (#0B192C)
    ctx.fillStyle = '#0B192C';
    ctx.fillRect(outerPad, y, cardW, headerH);
    ctx.fillStyle = '#F59E0B';
    ctx.fillRect(outerPad, y, cardW, 5);

    drawHeaderTopRow('#FBBF24', prio.label);

    let ty = y + headerTopPad + eyebrowH + 12;
    ctx.font = `${titleWeight} ${titleFontSize}px ${FONT_SANS}`;
    ctx.fillStyle = '#FFFFFF';
    for (const line of titleLines) {
      ctx.fillText(line, cx, ty);
      ty += titleLineH;
    }

    ctx.font = `500 ${subFontSize}px ${FONT_SANS}`;
    ctx.fillStyle = '#CBD5E1';
    let sy = ty + 8;
    for (const sLine of headerSubLines) {
      ctx.fillText(sLine, cx, sy);
      sy += subLineH;
    }

    if (showStats && summaryStats) {
      drawKpiStrip(ctx, cx, sy + 14, contentW, summaryStats, true);
    }
  }

  // === BODY ===
  y = outerPad + headerH + 20;

  detailSpecs.forEach((spec, idx) => {
    const isLast = idx === detailSpecs.length - 1;
    ctx.font = `600 ${labelFontSize}px ${FONT_SANS}`;
    ctx.fillStyle = '#64748B';
    ctx.fillText(spec.label, cx, y + 12);

    let vx = cx + labelColW;
    if (spec.dotColor) {
      ctx.beginPath();
      ctx.arc(vx + 7, y + 23, 6, 0, Math.PI * 2);
      ctx.fillStyle = spec.dotColor;
      ctx.fill();
      vx += 22;
    }

    if (spec.pillBg && spec.pillText) {
      drawPill(
        ctx,
        spec.valueLines[0] || '',
        vx,
        y + 5,
        spec.pillBg,
        spec.pillText,
        valueFontSize - 1,
        700,
        spec.mono ? FONT_MONO : FONT_SANS,
        13,
        6
      );
      if (spec.extraLines && spec.extraLines.length > 0) {
        ctx.font = `500 ${remindFontSize}px ${FONT_SANS}`;
        ctx.fillStyle = '#475569';
        let ey = y + 46;
        for (const eLine of spec.extraLines) {
          ctx.fillText(eLine, cx + labelColW, ey);
          ey += Math.round(remindFontSize * 1.32);
        }
      }
    } else {
      ctx.font = `700 ${valueFontSize}px ${spec.mono ? FONT_MONO : FONT_SANS}`;
      ctx.fillStyle = '#0F172A';
      let vy = y + 10;
      for (const vLine of spec.valueLines) {
        ctx.fillText(vLine, vx, vy);
        vy += valueLineH;
      }
    }

    if (!isLast) {
      ctx.fillStyle = '#E2E8F0';
      ctx.fillRect(cx, y + spec.height - 1, contentW, 1);
    }
    y += spec.height;
  });

  // Description box
  if (descLines.length > 0) {
    y += 14;
    drawRoundedRect(ctx, cx, y, contentW, descBoxH, 14);
    ctx.fillStyle = '#F8FAFC';
    ctx.fill();
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    drawRoundedRect(ctx, cx, y, 6, descBoxH, { tl: 14, tr: 0, br: 0, bl: 14 });
    ctx.fillStyle = '#0284C7';
    ctx.fill();

    ctx.font = `700 18px ${FONT_SANS}`;
    ctx.fillStyle = '#0F172A';
    ctx.fillText('รายละเอียดและสถานที่', cx + 20, y + 14);

    ctx.font = `500 ${descFontSize}px ${FONT_SANS}`;
    ctx.fillStyle = '#1E293B';
    let dy = y + 46;
    for (const dLine of descLines) {
      ctx.fillText(dLine, cx + 20, dy);
      dy += descLineH;
    }
    y += descBoxH;
  }

  if (showStats && summaryStats && style !== 'executive_card') {
    y += 18;
    drawKpiStrip(ctx, cx, y, contentW, summaryStats, false);
    y += 84;
  }

  // === FOOTER ===
  const footerY = outerPad + cardH - footerH;
  ctx.fillStyle = '#F1F5F9';
  ctx.fillRect(outerPad, footerY, cardW, footerH);
  ctx.fillStyle = '#E2E8F0';
  ctx.fillRect(outerPad, footerY, cardW, 1.5);

  ctx.font = `600 15px ${FONT_SANS}`;
  ctx.fillStyle = '#475569';
  ctx.fillText('ระบบน้องเลขา · แจ้งเตือน Telegram', cx, footerY + 16);

  ctx.textAlign = 'right';
  ctx.font = `700 16px ${FONT_MONO}`;
  ctx.fillStyle = '#0369A1';
  ctx.fillText(timeText, outerPad + cardW - innerPad, footerY + 15);
  ctx.textAlign = 'left';

  ctx.restore();
  return canvas.toDataURL('image/png');
}

export async function renderDailyDigestTelegramCardPng(params: {
  dateYMD: string;
  referenceTimeHM: string;
  items: FlexDigestItem[];
  heading?: string;
  format?: TelegramCardStyleOptions;
}): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  await ensureCanvasFontsLoaded();

  const { dateYMD, referenceTimeHM, items, heading, format } = params;
  const style: TelegramTemplateStyle = format?.style || 'executive_card';
  const headerTitle = (format?.headerTitle || DEFAULT_TELEGRAM_HEADER_TITLE).trim();
  const showStats = format?.showStats !== false;
  const { sizeOffset, titleWeight, lineRatio } = getFontMetrics(format);

  const thaiDate = formatThaiDateDisplay(dateYMD, 'long');
  const sorted = [...items].sort((a, b) =>
    String(a.time || '09:00').localeCompare(String(b.time || '09:00'))
  );
  const maxVisible = 10;
  const visible = sorted.slice(0, maxVisible);
  const overflowCount = Math.max(0, sorted.length - maxVisible);

  const total = sorted.length;
  const completed = sorted.filter((i) => i.status === 'completed').length;
  const pending = total - completed;

  // Mobile-first compact width (540px logical @ 2x DPR = 1080px crisp PNG)
  const outerPad = 8;
  const cardW = 540;
  const totalW = cardW + outerPad * 2;
  const innerPad = 22;
  const contentW = cardW - innerPad * 2;

  const measurePair = createCanvasPair(totalW, 200);
  if (!measurePair) return null;
  const mctx = measurePair.ctx;

  const itemTitleSize = (style === 'compact_brief' ? 20 : 21) + Math.min(3, Math.max(-2, sizeOffset));
  const itemTitleLineH = Math.round(itemTitleSize * lineRatio);
  const itemDescSize = 17 + Math.min(2, Math.max(-2, sizeOffset));
  const itemDescLineH = Math.round(itemDescSize * 1.35);

  const getPeriod = (hm: string) => {
    const h = Number(String(hm || '09:00').split(':')[0]);
    if (Number.isNaN(h) || h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    return 'evening';
  };

  type RenderGroup = {
    label?: string;
    accentColor?: string;
    rows: Array<{
      item: FlexDigestItem;
      index: number;
      titleLines: string[];
      descLine: string;
      rowHeight: number;
    }>;
  };

  const buildRows = (list: FlexDigestItem[], startIndex: number) =>
    list.map((item, idx) => {
      // Two-tier row layout: top row has Time Pill + Status Pill; below it full-width Title + Desc!
      // Giving Title full card width makes it HUGE and prevents cramped squeezing!
      mctx.font = `${titleWeight} ${itemTitleSize}px ${FONT_SANS}`;
      const titleLines = wrapTextLines(mctx, item.title || 'กำหนดการ', contentW - 34, 3);
      const rawDesc = (item.description || '').replace(/\s+/g, ' ').trim();
      let descLine = '';
      if (rawDesc && style !== 'compact_brief') {
        mctx.font = `400 ${itemDescSize}px ${FONT_SANS}`;
        descLine = wrapTextLines(mctx, rawDesc, contentW - 34, 1)[0] || '';
      }
      const rowHeight =
        50 + // top meta bar (time pill + status pill)
        Math.max(1, titleLines.length) * itemTitleLineH +
        (descLine ? itemDescLineH + 4 : 0) +
        14;
      return { item, index: startIndex + idx + 1, titleLines, descLine, rowHeight };
    });

  const groups: RenderGroup[] = [];
  if (style === 'timeline_digest' && visible.length > 0) {
    const morning = visible.filter((i) => getPeriod(i.time) === 'morning');
    const afternoon = visible.filter((i) => getPeriod(i.time) === 'afternoon');
    const evening = visible.filter((i) => getPeriod(i.time) === 'evening');
    let runningIdx = 0;
    if (morning.length > 0) {
      groups.push({
        label: `ช่วงเช้า (ก่อน 12:00 น.) · ${morning.length} งาน`,
        accentColor: '#D97706',
        rows: buildRows(morning, runningIdx),
      });
      runningIdx += morning.length;
    }
    if (afternoon.length > 0) {
      groups.push({
        label: `ช่วงบ่าย (12:00–16:59 น.) · ${afternoon.length} งาน`,
        accentColor: '#0284C7',
        rows: buildRows(afternoon, runningIdx),
      });
      runningIdx += afternoon.length;
    }
    if (evening.length > 0) {
      groups.push({
        label: `ช่วงเย็น (17:00 น. เป็นต้นไป) · ${evening.length} งาน`,
        accentColor: '#4F46E5',
        rows: buildRows(evening, runningIdx),
      });
    }
  } else {
    groups.push({ rows: buildRows(visible, 0) });
  }

  const headerH =
    style === 'compact_brief'
      ? 136
      : showStats
      ? 262
      : 162;

  let bodyInnerH = 0;
  if (visible.length === 0) {
    bodyInnerH = 104;
  } else {
    groups.forEach((g, gIdx) => {
      if (g.label) bodyInnerH += 38;
      g.rows.forEach((r) => {
        bodyInnerH += r.rowHeight + 10;
      });
      if (gIdx < groups.length - 1) bodyInnerH += 8;
    });
    if (overflowCount > 0) bodyInnerH += 42;
  }

  const bodyKpiH = showStats && style === 'compact_brief' ? 96 : 0;
  const footerH = 50;
  const cardH = headerH + 20 + bodyInnerH + bodyKpiH + 18 + footerH;
  const totalH = cardH + outerPad * 2;

  const pair = createCanvasPair(totalW, totalH);
  if (!pair) return null;
  const { canvas, ctx } = pair;

  ctx.fillStyle = '#CBD5E1';
  ctx.fillRect(0, 0, totalW, totalH);

  drawRoundedRect(ctx, outerPad, outerPad, cardW, cardH, 20);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  ctx.save();
  drawRoundedRect(ctx, outerPad, outerPad, cardW, cardH, 20);
  ctx.clip();

  const cx = outerPad + innerPad;
  let y = outerPad;

  // === HEADER ===
  if (style === 'compact_brief') {
    ctx.fillStyle = '#0284C7';
    ctx.fillRect(outerPad, y, cardW, 8);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(outerPad, y + 8, cardW, headerH - 8);

    ctx.font = `700 16px ${FONT_SANS}`;
    ctx.fillStyle = '#0369A1';
    const clippedEyebrow = wrapTextLines(mctx, headerTitle, contentW, 1)[0] || headerTitle;
    ctx.fillText(clippedEyebrow, cx, y + 22);

    ctx.font = `700 ${28 + sizeOffset}px ${FONT_SANS}`;
    ctx.fillStyle = '#0F172A';
    ctx.fillText(heading || 'สรุปตารางงานประจำวัน', cx, y + 52);

    ctx.font = `500 18px ${FONT_SANS}`;
    ctx.fillStyle = '#475569';
    ctx.fillText(`${thaiDate} · ${referenceTimeHM} น.`, cx, y + 96);

    ctx.fillStyle = '#E2E8F0';
    ctx.fillRect(outerPad, y + headerH - 1, cardW, 1.5);
  } else {
    if (style === 'timeline_digest') {
      const grad = ctx.createLinearGradient(outerPad, y, outerPad + cardW, y + headerH);
      grad.addColorStop(0, '#0F172A');
      grad.addColorStop(1, '#1E3A8A');
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = '#0B192C';
    }
    ctx.fillRect(outerPad, y, cardW, headerH);

    ctx.fillStyle = style === 'timeline_digest' ? '#38BDF8' : '#F59E0B';
    ctx.fillRect(outerPad, y, cardW, 5);

    const timeBadgeLabel = `ณ ${referenceTimeHM} น.`;
    ctx.font = `700 15px ${FONT_MONO}`;
    const tbW = ctx.measureText(timeBadgeLabel).width + 24;
    drawPill(
      ctx,
      timeBadgeLabel,
      outerPad + cardW - innerPad - tbW,
      y + 20,
      'rgba(255,255,255,0.16)',
      '#FFFFFF',
      15,
      700,
      FONT_MONO,
      12,
      5
    );

    ctx.font = `700 16px ${FONT_SANS}`;
    ctx.fillStyle = style === 'timeline_digest' ? '#7DD3FC' : '#FBBF24';
    const clippedEyebrow =
      wrapTextLines(mctx, headerTitle, contentW - tbW - 10, 1)[0] || headerTitle;
    ctx.fillText(clippedEyebrow, cx, y + 25);

    ctx.font = `700 ${30 + sizeOffset}px ${FONT_SANS}`;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(
      heading || (style === 'timeline_digest' ? 'ไทม์ไลน์กำหนดการประจำวัน' : 'สรุปตารางงานประจำวัน'),
      cx,
      y + 62
    );

    ctx.font = `500 19px ${FONT_SANS}`;
    ctx.fillStyle = '#CBD5E1';
    ctx.fillText(thaiDate, cx, y + 108);

    if (showStats) {
      drawKpiStrip(ctx, cx, y + 152, contentW, { total, pending, completed }, true);
    }
  }

  // === BODY ===
  y = outerPad + headerH + 20;

  if (visible.length === 0) {
    drawRoundedRect(ctx, cx, y, contentW, 88, 14);
    ctx.fillStyle = '#F8FAFC';
    ctx.fill();
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = `600 20px ${FONT_SANS}`;
    ctx.fillStyle = '#475569';
    ctx.fillText('ยังไม่มีกำหนดการที่ต้องดำเนินการในวันนี้', cx + contentW / 2, y + 32);
    ctx.textAlign = 'left';
    y += 104;
  } else {
    groups.forEach((group, gIdx) => {
      if (group.label) {
        drawRoundedRect(ctx, cx, y, 5, 24, 2.5);
        ctx.fillStyle = group.accentColor || '#0284C7';
        ctx.fill();

        ctx.font = `700 18px ${FONT_SANS}`;
        ctx.fillStyle = '#1E293B';
        ctx.fillText(group.label, cx + 14, y + 1);
        y += 38;
      }

      group.rows.forEach((row) => {
        const { item, index, titleLines, descLine, rowHeight } = row;
        const isDone = item.status === 'completed';
        const isHigh = !isDone && item.priority === 'high';
        const rowBg = isDone ? '#F8FAFC' : isHigh ? '#FEF2F2' : '#FFFFFF';
        const rowBorder = isDone ? '#CBD5E1' : isHigh ? '#FCA5A5' : '#CBD5E1';

        drawRoundedRect(ctx, cx, y, contentW, rowHeight, 14);
        ctx.fillStyle = rowBg;
        ctx.fill();
        ctx.strokeStyle = rowBorder;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        const stripColor = isDone
          ? '#10B981'
          : isHigh
          ? '#DC2626'
          : item.status === 'in_progress'
          ? '#2563EB'
          : '#0284C7';
        drawRoundedRect(ctx, cx, y, 6, rowHeight, { tl: 14, tr: 0, br: 0, bl: 14 });
        ctx.fillStyle = stripColor;
        ctx.fill();

        // Top row: #index + Monospace Time Pill (left) + Status Pill (right)
        const timeStr = `${index}. ${(item.time || '09:00').trim()} น.`;
        drawPill(
          ctx,
          timeStr,
          cx + 16,
          y + 11,
          isDone ? '#E2E8F0' : isHigh ? '#FEE2E2' : '#E0F2FE',
          isDone ? '#475569' : isHigh ? '#B91C1C' : '#0369A1',
          17,
          700,
          FONT_MONO,
          11,
          4
        );

        const statusTag = isDone
          ? { text: 'เสร็จแล้ว', bg: '#DCFCE7', color: '#15803D' }
          : isHigh
          ? { text: 'ด่วนมาก', bg: '#DC2626', color: '#FFFFFF' }
          : item.status === 'in_progress'
          ? { text: 'กำลังทำ', bg: '#DBEAFE', color: '#1D4ED8' }
          : { text: 'รอทำ', bg: '#FEF3C7', color: '#B45309' };

        ctx.font = `700 15px ${FONT_SANS}`;
        const stW = ctx.measureText(statusTag.text).width + 22;
        drawPill(
          ctx,
          statusTag.text,
          cx + contentW - stW - 12,
          y + 11,
          statusTag.bg,
          statusTag.color,
          15,
          700,
          FONT_SANS,
          11,
          4
        );

        // Full-width crisp Title lines below top row
        let ty = y + 50;
        ctx.font = `${titleWeight} ${itemTitleSize}px ${FONT_SANS}`;
        ctx.fillStyle = isDone ? '#64748B' : '#0F172A';
        for (const tLine of titleLines) {
          ctx.fillText(tLine, cx + 18, ty);
          if (isDone) {
            const tw = ctx.measureText(tLine).width;
            ctx.strokeStyle = '#94A3B8';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cx + 18, ty + itemTitleSize * 0.55);
            ctx.lineTo(cx + 18 + tw, ty + itemTitleSize * 0.55);
            ctx.stroke();
          }
          ty += itemTitleLineH;
        }

        if (descLine) {
          ctx.font = `400 ${itemDescSize}px ${FONT_SANS}`;
          ctx.fillStyle = '#475569';
          ctx.fillText(descLine, cx + 18, ty + 2);
        }

        y += rowHeight + 10;
      });

      if (gIdx < groups.length - 1) y += 8;
    });

    if (overflowCount > 0) {
      ctx.font = `600 17px ${FONT_SANS}`;
      ctx.fillStyle = '#475569';
      ctx.fillText(`และกำหนดการเพิ่มเติมอีก ${overflowCount} รายการ (แตะปุ่มด้านล่าง)`, cx, y + 6);
      y += 42;
    }
  }

  if (showStats && style === 'compact_brief') {
    y += 10;
    drawKpiStrip(ctx, cx, y, contentW, { total, pending, completed }, false);
  }

  // === FOOTER ===
  const footerY = outerPad + cardH - footerH;
  ctx.fillStyle = '#F1F5F9';
  ctx.fillRect(outerPad, footerY, cardW, footerH);
  ctx.fillStyle = '#E2E8F0';
  ctx.fillRect(outerPad, footerY, cardW, 1.5);

  ctx.font = `600 15px ${FONT_SANS}`;
  ctx.fillStyle = '#475569';
  ctx.fillText('ระบบน้องเลขา · สรุปงานอัตโนมัติ', cx, footerY + 16);

  ctx.textAlign = 'right';
  ctx.font = `700 16px ${FONT_MONO}`;
  ctx.fillStyle = '#0369A1';
  ctx.fillText(`${total} รายการ`, outerPad + cardW - innerPad, footerY + 15);
  ctx.textAlign = 'left';

  ctx.restore();
  return canvas.toDataURL('image/png');
}

export async function renderTestConnectionCardPng(params: {
  headerTitle?: string;
  nowHM: string;
  summaryStats?: { total: number; todayCount: number; pendingCount: number };
  showStats?: boolean;
}): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  await ensureCanvasFontsLoaded();

  const headerTitle = (params.headerTitle || DEFAULT_TELEGRAM_HEADER_TITLE).trim();
  const outerPad = 8;
  const cardW = 540;
  const cardH = params.showStats !== false && params.summaryStats ? 356 : 244;
  const totalW = cardW + outerPad * 2;
  const totalH = cardH + outerPad * 2;
  const innerPad = 24;
  const contentW = cardW - innerPad * 2;

  const pair = createCanvasPair(totalW, totalH);
  if (!pair) return null;
  const { canvas, ctx } = pair;

  ctx.fillStyle = '#CBD5E1';
  ctx.fillRect(0, 0, totalW, totalH);

  drawRoundedRect(ctx, outerPad, outerPad, cardW, cardH, 20);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  ctx.save();
  drawRoundedRect(ctx, outerPad, outerPad, cardW, cardH, 20);
  ctx.clip();

  const cx = outerPad + innerPad;
  const y = outerPad;

  ctx.fillStyle = '#0B192C';
  ctx.fillRect(outerPad, y, cardW, 174);
  ctx.fillStyle = '#10B981';
  ctx.fillRect(outerPad, y, cardW, 5);

  const okPillW = 132;
  drawPill(
    ctx,
    'เชื่อมต่อสำเร็จ',
    outerPad + cardW - innerPad - okPillW,
    y + 20,
    '#059669',
    '#FFFFFF',
    16,
    700,
    FONT_SANS,
    13,
    5
  );

  ctx.font = `700 17px ${FONT_SANS}`;
  ctx.fillStyle = '#FBBF24';
  const clippedHeader =
    wrapTextLines(ctx, headerTitle, contentW - okPillW - 10, 1)[0] || headerTitle;
  ctx.fillText(clippedHeader, cx, y + 25);

  ctx.font = `700 29px ${FONT_SANS}`;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('ทดสอบการ์ด Telegram สำเร็จ!', cx, y + 66);

  ctx.font = `500 18px ${FONT_SANS}`;
  ctx.fillStyle = '#CBD5E1';
  ctx.fillText(`พร้อมส่งแจ้งเตือนฟรีไม่จำกัด · เวลา ${params.nowHM} น.`, cx, y + 114);

  if (params.showStats !== false && params.summaryStats) {
    drawKpiStrip(
      ctx,
      cx,
      y + 196,
      contentW,
      {
        total: params.summaryStats.total,
        pending: params.summaryStats.pendingCount,
        completed: Math.max(0, params.summaryStats.total - params.summaryStats.pendingCount),
      },
      false
    );
  }

  const footerY = outerPad + cardH - 50;
  ctx.fillStyle = '#F1F5F9';
  ctx.fillRect(outerPad, footerY, cardW, 50);
  ctx.fillStyle = '#E2E8F0';
  ctx.fillRect(outerPad, footerY, cardW, 1.5);

  ctx.font = `600 15px ${FONT_SANS}`;
  ctx.fillStyle = '#475569';
  ctx.fillText('ระบบน้องเลขา · โหมดการ์ดภาพกราฟิกคมชัด', cx, footerY + 16);

  ctx.restore();
  return canvas.toDataURL('image/png');
}
