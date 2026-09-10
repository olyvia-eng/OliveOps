const EMAIL_OR_URL = /@|(?:https?:\/\/)|www\.|\.[a-z]{2,}(?:\/|$)/i;

const splitAtBreakOpportunities = (token) => token
  .split(/([@./_-])/)
  .filter(Boolean)
  .reduce((parts, part) => {
    if (parts.length && /^[@./_-]$/.test(part)) parts[parts.length - 1] += part;
    else parts.push(part);
    return parts;
  }, []);

export function wrapPdfText(doc, value, width, options = {}) {
  const text = String(value ?? '').trim();
  if (!text) return [];
  const forceBreak = options.forceBreakLongWords !== false;
  const paragraphs = text.split(/\r\n?|\n/);
  const wrapped = [];

  const fitToken = (token) => {
    if (doc.getTextWidth(token) <= width) return [token];
    const candidates = EMAIL_OR_URL.test(token) ? splitAtBreakOpportunities(token) : [token];
    const pieces = [];
    for (const candidate of candidates) {
      if (doc.getTextWidth(candidate) <= width || !forceBreak) {
        pieces.push(candidate);
        continue;
      }
      let piece = '';
      for (const character of candidate) {
        if (piece && doc.getTextWidth(piece + character) > width) {
          pieces.push(piece);
          piece = character;
        } else piece += character;
      }
      if (piece) pieces.push(piece);
    }
    return pieces;
  };

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      wrapped.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      const pieces = fitToken(word);
      for (let index = 0; index < pieces.length; index += 1) {
        const piece = pieces[index];
        const separator = line && index === 0 ? ' ' : '';
        const candidate = `${line}${separator}${piece}`;
        if (line && doc.getTextWidth(candidate) > width) {
          wrapped.push(line);
          line = piece;
        } else line = candidate;
      }
    }
    if (line) wrapped.push(line);
  }
  return wrapped;
}

export function measurePdfText(doc, value, width, options = {}) {
  const fontSize = options.fontSize ?? 9;
  const lineHeight = options.lineHeight ?? fontSize * 1.35;
  doc.setFont(options.font ?? 'helvetica', options.style ?? 'normal');
  doc.setFontSize(fontSize);
  const lines = options.noWrap ? [String(value ?? '').trim()] : wrapPdfText(doc, value, width, options);
  return {
    lines,
    lineHeight,
    height: lines.length ? lines.length * lineHeight : 0,
    width: lines.reduce((maximum, line) => Math.max(maximum, doc.getTextWidth(line)), 0),
  };
}

export function fitPdfText(doc, value, width, options = {}) {
  const minimumFontSize = options.minimumFontSize ?? 7;
  let fontSize = options.fontSize ?? 9;
  let measurement;
  do {
    measurement = measurePdfText(doc, value, width, { ...options, fontSize, noWrap: true });
    if (measurement.width <= width || fontSize <= minimumFontSize) break;
    fontSize -= 0.25;
  } while (fontSize >= minimumFontSize);
  return { ...measurement, fontSize };
}

export function createPdfFlow(doc, options) {
  const trace = [];
  let cursorY = options.startY;
  let page = doc.getCurrentPageInfo().pageNumber;

  const record = (entry) => trace.push({ page, ...entry });
  const setCursor = (value) => { cursorY = value; };
  const addPage = () => {
    doc.addPage();
    page = doc.getCurrentPageInfo().pageNumber;
    options.onPageAdded?.();
    cursorY = options.pageStartY;
  };
  const ensureSpace = (height) => {
    if (cursorY + height > options.contentBottom) addPage();
    return cursorY;
  };
  const drawText = (value, config = {}) => {
    const left = config.left ?? options.margin;
    const width = config.width ?? options.contentWidth;
    const measurement = measurePdfText(doc, value, width, config);
    const lineHeight = measurement.lineHeight;
    const linesPerPage = Math.max(1, Math.floor((options.contentBottom - options.pageStartY) / lineHeight));
    let offset = 0;
    while (offset < measurement.lines.length) {
      ensureSpace(lineHeight);
      const available = Math.max(1, Math.floor((options.contentBottom - cursorY) / lineHeight));
      const pageLines = measurement.lines.slice(offset, offset + Math.min(available, linesPerPage));
      if (!pageLines.length) {
        addPage();
        continue;
      }
      doc.setFont(config.font ?? 'helvetica', config.style ?? 'normal');
      doc.setFontSize(config.fontSize ?? 9);
      if (config.color) doc.setTextColor(...config.color);
      pageLines.forEach((line, index) => doc.text(line, config.align === 'right' ? left + width : left, cursorY + index * lineHeight, { align: config.align }));
      record({ kind: config.kind ?? 'text', x: left, y: cursorY - (config.fontSize ?? 9), width, height: pageLines.length * lineHeight, text: pageLines.join('\n') });
      cursorY += pageLines.length * lineHeight;
      offset += pageLines.length;
      if (offset < measurement.lines.length) addPage();
    }
    return measurement;
  };

  return {
    trace,
    get cursorY() { return cursorY; },
    get page() { return page; },
    setCursor,
    addPage,
    ensureSpace,
    advance: (height) => { cursorY += height; },
    drawText,
    record,
  };
}

export function assertPdfLayoutBounds(trace, { pageWidth, pageHeight, margin = 0 }) {
  const errors = [];
  for (const box of trace) {
    if (box.x < margin || box.x + box.width > pageWidth - margin || box.y < 0 || box.y + box.height > pageHeight) {
      errors.push(`Page ${box.page} ${box.kind} is outside page bounds.`);
    }
  }
  return errors;
}