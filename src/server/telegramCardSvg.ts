import { Resvg } from '@resvg/resvg-js';

function escapeXml(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrapThaiText(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const clean = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  let segmenter: Intl.Segmenter | null = null;
  try {
    if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
      segmenter = new Intl.Segmenter('th', { granularity: 'word' });
    }
  } catch {
    segmenter = null;
  }

  const lines: string[] = [];
  const paragraphs = clean.split('\n');

  for (const para of paragraphs) {
    if (lines.length >= maxLines) break;
    const trimmed = para.trim();
    if (!trimmed) continue;

    const tokens = segmenter
      ? Array.from(segmenter.segment(trimmed), (s) => s.segment)
      : trimmed.split(/(\s+)/);

    let current = '';
    for (const token of tokens) {
      const candidate = current + token;
      if (candidate.length <= maxCharsPerLine) {
        current = candidate;
      } else {
        if (current.trim()) {
          lines.push(current.trimEnd());
          if (lines.length >= maxLines) break;
          current = token.trimStart();
        } else {
          let chunk = token;
          while (chunk.length > maxCharsPerLine && lines.length < maxLines) {
            lines.push(chunk.slice(0, maxCharsPerLine));
            chunk = chunk.slice(maxCharsPerLine);
          }
          current = chunk;
        }
      }
    }
    if (lines.length < maxLines && current.trim()) {
      lines.push(current.trimEnd());
    }
  }

  if (lines.length === maxLines && clean.length > lines.join('').length + 2) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = last.length > 2 ? `${last.slice(0, Math.max(1, last.length - 1))}…` : `${last}…`;
  }
  return lines;
}

function svgToPngBuffer(svg: string, width = 1200): Buffer | null {
  try {
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: width },
      font: {
        loadSystemFonts: true,
        defaultFontFamily: 'Noto Sans Thai',
      },
    });
    return Buffer.from(resvg.render().asPng());
  } catch {
    return null;
  }
}

export function renderServerSingleTaskCardPng(params: {
  headerTitle: string;
  taskTitle: string;
  description?: string;
  dateDisplay: string;
  timeDisplay: string;
  remindLabel?: string;
  categoryName?: string;
  priority: 'high' | 'medium' | 'low' | string;
  showStats?: boolean;
  stats?: { total: number; pending: number; completed: number };
}): Buffer | null {
  const W = 720;
  const isHigh = params.priority === 'high';
  const isLow = params.priority === 'low';
  const prioLabel = isHigh ? 'ด่วนมาก' : isLow ? 'ทั่วไป' : 'สำคัญปานกลาง';
  const prioBg = isHigh ? '#DC2626' : isLow ? '#059669' : '#D97706';
  const headingText = isHigh ? 'แจ้งเตือนภารกิจด่วนมาก' : 'แจ้งเตือนกำหนดการตามเวลา';
  const accentColor = isHigh ? '#EF4444' : '#F59E0B';

  const titleLines = wrapThaiText(params.taskTitle || 'รายการงาน', 30, 3);
  const descLines = params.description?.trim()
    ? wrapThaiText(params.description.trim(), 44, 4)
    : [];

  const titleBlockH = Math.max(1, titleLines.length) * 34;
  const descBlockH = descLines.length > 0 ? 44 + descLines.length * 24 + 14 : 0;
  const statsBlockH = params.showStats !== false && params.stats ? 74 : 0;

  const headerH = 112;
  const bodyTop = headerH + 22;
  const cardPad = 24;
  const metaTop = bodyTop + cardPad + titleBlockH + 18;
  const metaH = 126;
  const descTop = metaTop + metaH + (descLines.length > 0 ? 16 : 0);
  const cardBottom = descTop + descBlockH + cardPad;
  const statsTop = cardBottom + (statsBlockH > 0 ? 16 : 0);
  const footerTop = statsTop + statsBlockH + 20;
  const H = footerTop + 34;

  const titleSvg = titleLines
    .map(
      (line, idx) =>
        `<text x="54" y="${bodyTop + cardPad + 24 + idx * 34}" fill="#0F172A" font-size="25" font-weight="700">${escapeXml(
          line
        )}</text>`
    )
    .join('');

  const descSvg =
    descLines.length > 0
      ? `
      <rect x="48" y="${descTop}" width="${W - 96}" height="${descBlockH}" rx="14" fill="#F8FAFC" stroke="#E2E8F0" stroke-width="1.5"/>
      <text x="66" y="${descTop + 28}" fill="#475569" font-size="14" font-weight="700">รายละเอียดเพิ่มเติม</text>
      ${descLines
        .map(
          (line, idx) =>
            `<text x="66" y="${descTop + 54 + idx * 24}" fill="#1E293B" font-size="16" font-weight="500">${escapeXml(
              line
            )}</text>`
        )
        .join('')}
    `
      : '';

  const statsSvg =
    params.showStats !== false && params.stats
      ? `
      <rect x="28" y="${statsTop}" width="${W - 56}" height="62" rx="14" fill="#0F172A"/>
      <text x="145" y="${statsTop + 26}" text-anchor="middle" fill="#94A3B8" font-size="13" font-weight="600">ทั้งหมด</text>
      <text x="145" y="${statsTop + 50}" text-anchor="middle" fill="#FFFFFF" font-size="22" font-weight="700">${params.stats.total}</text>
      <line x1="255" y1="${statsTop + 14}" x2="255" y2="${statsTop + 48}" stroke="#334155" stroke-width="1.5"/>
      <text x="360" y="${statsTop + 26}" text-anchor="middle" fill="#FCD34D" font-size="13" font-weight="600">รอดำเนินการ</text>
      <text x="360" y="${statsTop + 50}" text-anchor="middle" fill="#FDE68A" font-size="22" font-weight="700">${params.stats.pending}</text>
      <line x1="465" y1="${statsTop + 14}" x2="465" y2="${statsTop + 48}" stroke="#334155" stroke-width="1.5"/>
      <text x="575" y="${statsTop + 26}" text-anchor="middle" fill="#6EE7B7" font-size="13" font-weight="600">เสร็จสิ้นแล้ว</text>
      <text x="575" y="${statsTop + 50}" text-anchor="middle" fill="#34D399" font-size="22" font-weight="700">${params.stats.completed}</text>
    `
      : '';

  const timeCombined = params.remindLabel
    ? `${params.timeDisplay} น. (${params.remindLabel})`
    : `${params.timeDisplay} น.`;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <defs>
        <linearGradient id="navyBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0B162C"/>
          <stop offset="100%" stop-color="#1E3A5F"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="#E2E8F0"/>
      <rect x="0" y="0" width="${W}" height="${headerH}" fill="url(#navyBg)"/>
      <rect x="0" y="${headerH - 5}" width="${W}" height="5" fill="${accentColor}"/>

      <text x="32" y="42" fill="#FCD34D" font-size="15" font-weight="700">${escapeXml(
        params.headerTitle || 'สำนักบริหารแรงงานต่างด้าว · ระบบน้องเลขา'
      )}</text>
      <text x="32" y="82" fill="#FFFFFF" font-size="28" font-weight="700">${escapeXml(
        headingText
      )}</text>

      <rect x="${W - 156}" y="34" width="126" height="36" rx="18" fill="${prioBg}"/>
      <text x="${W - 93}" y="58" text-anchor="middle" fill="#FFFFFF" font-size="16" font-weight="700">${escapeXml(
        prioLabel
      )}</text>

      <rect x="28" y="${bodyTop}" width="${W - 56}" height="${cardBottom - bodyTop}" rx="18" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1.5"/>
      <rect x="28" y="${bodyTop + 18}" width="6" height="${Math.max(36, titleBlockH)}" rx="3" fill="${prioBg}"/>
      ${titleSvg}

      <rect x="48" y="${metaTop}" width="${W - 96}" height="${metaH}" rx="14" fill="#F8FAFC" stroke="#E2E8F0" stroke-width="1.5"/>
      <text x="68" y="${metaTop + 34}" fill="#64748B" font-size="15" font-weight="600">วันที่:</text>
      <text x="155" y="${metaTop + 34}" fill="#0F172A" font-size="17" font-weight="700">${escapeXml(
        params.dateDisplay
      )}</text>
      <line x1="66" y1="${metaTop + 48}" x2="${W - 66}" y2="${metaTop + 48}" stroke="#E2E8F0" stroke-width="1"/>
      <text x="68" y="${metaTop + 76}" fill="#64748B" font-size="15" font-weight="600">เวลา:</text>
      <text x="155" y="${metaTop + 76}" fill="#0369A1" font-size="17" font-weight="700">${escapeXml(
        timeCombined
      )}</text>
      <line x1="66" y1="${metaTop + 90}" x2="${W - 66}" y2="${metaTop + 90}" stroke="#E2E8F0" stroke-width="1"/>
      <text x="68" y="${metaTop + 114}" fill="#64748B" font-size="15" font-weight="600">หมวดหมู่:</text>
      <text x="155" y="${metaTop + 114}" fill="#1E293B" font-size="16" font-weight="600">${escapeXml(
        params.categoryName || 'งานตารางทีม'
      )}</text>

      ${descSvg}
      ${statsSvg}

      <text x="32" y="${footerTop + 12}" fill="#64748B" font-size="13" font-weight="600">ระบบน้องเลขา · แจ้งเตือนกำหนดการอัตโนมัติ</text>
      <text x="${W - 32}" y="${footerTop + 12}" text-anchor="end" fill="#0369A1" font-size="13" font-weight="700">${escapeXml(
        params.timeDisplay
      )} น.</text>
    </svg>
  `;

  return svgToPngBuffer(svg, 1200);
}

export function renderServerDailyDigestCardPng(params: {
  headerTitle: string;
  dateDisplay: string;
  nowHM: string;
  items: Array<{
    time: string;
    title: string;
    description?: string;
    priority?: string;
    status?: string;
  }>;
}): Buffer | null {
  const W = 720;
  const visibleItems = params.items.slice(0, 10);
  const total = params.items.length;
  const done = params.items.filter((i) => i.status === 'completed').length;
  const pending = total - done;

  const headerH = 186;
  const rowGap = 12;
  const rowH = 78;
  const listTop = headerH + 20;
  const extraFooterNote = total > visibleItems.length ? 30 : 0;
  const H = listTop + visibleItems.length * (rowH + rowGap) + extraFooterNote + 46;

  const rowsSvg = visibleItems
    .map((item, idx) => {
      const y = listTop + idx * (rowH + rowGap);
      const isDone = item.status === 'completed';
      const isHigh = !isDone && item.priority === 'high';
      const barColor = isDone ? '#10B981' : isHigh ? '#DC2626' : '#0284C7';
      const pillBg = isDone ? '#DCFCE7' : isHigh ? '#FEE2E2' : '#E0F2FE';
      const pillText = isDone ? '#15803D' : isHigh ? '#B91C1C' : '#0369A1';
      const pillLabel = isDone ? 'เสร็จแล้ว' : isHigh ? 'ด่วนมาก' : 'รอดำเนินการ';
      const cleanTitle =
        item.title.length > 34 ? `${item.title.slice(0, 33)}…` : item.title;
      const cleanDesc = item.description?.trim()
        ? item.description.trim().slice(0, 46) + (item.description.trim().length > 46 ? '…' : '')
        : '';

      return `
        <rect x="26" y="${y}" width="${W - 52}" height="${rowH}" rx="14" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1.2"/>
        <rect x="26" y="${y + 10}" width="6" height="${rowH - 20}" rx="3" fill="${barColor}"/>
        <text x="48" y="${y + 26}" fill="#0284C7" font-size="14" font-weight="700">${idx + 1}. ${escapeXml(
        item.time || '09:00'
      )} น.</text>
        <rect x="${W - 144}" y="${y + 10}" width="104" height="24" rx="12" fill="${pillBg}"/>
        <text x="${W - 92}" y="${y + 26}" text-anchor="middle" fill="${pillText}" font-size="12" font-weight="700">${pillLabel}</text>
        <text x="48" y="${y + 50}" fill="${isDone ? '#64748B' : '#0F172A'}" font-size="17" font-weight="700" ${
        isDone ? 'text-decoration="line-through"' : ''
      }>${escapeXml(cleanTitle)}</text>
        ${
          cleanDesc
            ? `<text x="48" y="${y + 69}" fill="#64748B" font-size="13" font-weight="500">${escapeXml(
                cleanDesc
              )}</text>`
            : ''
        }
      `;
    })
    .join('');

  const moreSvg =
    total > visibleItems.length
      ? `<text x="${W / 2}" y="${
          listTop + visibleItems.length * (rowH + rowGap) + 14
        }" text-anchor="middle" fill="#475569" font-size="14" font-weight="600">และอีก ${
          total - visibleItems.length
        } รายการในปฏิทินทีม</text>`
      : '';

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <defs>
        <linearGradient id="digestNavy" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0B162C"/>
          <stop offset="100%" stop-color="#1E3A5F"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="#E2E8F0"/>
      <rect x="0" y="0" width="${W}" height="${headerH}" fill="url(#digestNavy)"/>
      <rect x="0" y="${headerH - 4}" width="${W}" height="4" fill="#F59E0B"/>

      <text x="30" y="36" fill="#FCD34D" font-size="14" font-weight="700">${escapeXml(
        params.headerTitle || 'สำนักบริหารแรงงานต่างด้าว · ระบบน้องเลขา'
      )}</text>
      <text x="30" y="72" fill="#FFFFFF" font-size="27" font-weight="700">สรุปตารางงานประจำวัน</text>
      <text x="30" y="98" fill="#CBD5E1" font-size="15" font-weight="500">${escapeXml(
        params.dateDisplay
      )} · อัปเดต ${escapeXml(params.nowHM)} น.</text>

      <rect x="28" y="114" width="206" height="54" rx="12" fill="rgba(255,255,255,0.1)"/>
      <text x="131" y="142" text-anchor="middle" fill="#FFFFFF" font-size="22" font-weight="700">${total}</text>
      <text x="131" y="160" text-anchor="middle" fill="#CBD5E1" font-size="12" font-weight="600">ทั้งหมด</text>

      <rect x="257" y="114" width="206" height="54" rx="12" fill="rgba(255,255,255,0.1)"/>
      <text x="360" y="142" text-anchor="middle" fill="#FDE68A" font-size="22" font-weight="700">${pending}</text>
      <text x="360" y="160" text-anchor="middle" fill="#FCD34D" font-size="12" font-weight="600">รอดำเนินการ</text>

      <rect x="486" y="114" width="206" height="54" rx="12" fill="rgba(255,255,255,0.1)"/>
      <text x="589" y="142" text-anchor="middle" fill="#6EE7B7" font-size="22" font-weight="700">${done}</text>
      <text x="589" y="160" text-anchor="middle" fill="#34D399" font-size="12" font-weight="600">เสร็จสิ้นแล้ว</text>

      ${rowsSvg}
      ${moreSvg}

      <text x="30" y="${H - 16}" fill="#64748B" font-size="13" font-weight="600">ระบบน้องเลขา · สรุปงานอัตโนมัติ</text>
      <text x="${W - 30}" y="${H - 16}" text-anchor="end" fill="#0369A1" font-size="13" font-weight="700">${total} รายการ</text>
    </svg>
  `;

  return svgToPngBuffer(svg, 1200);
}
