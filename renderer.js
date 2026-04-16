const PERIODS = [
  { index: 1, start: '08:00', end: '08:50' },
  { index: 2, start: '09:00', end: '09:50' },
  { index: 3, start: '10:10', end: '11:00' },
  { index: 4, start: '11:10', end: '12:00' },
  { index: 5, start: '14:00', end: '14:50' },
  { index: 6, start: '15:00', end: '15:50' },
  { index: 7, start: '16:10', end: '17:00' },
  { index: 8, start: '17:10', end: '18:00' },
  { index: 9, start: '19:00', end: '19:45' },
  { index: 10, start: '19:50', end: '20:35' },
  { index: 11, start: '20:45', end: '21:30' }
];

const WEEKDAY_SHORT = ['一', '二', '三', '四', '五', '六', '日'];

const state = {
  filePath: '',
  rawEvents: [],
  occurrences: [],
  loadError: null,
  now: new Date(),
  viewDate: new Date(),
  renderedWeekStartMs: 0,
  renderedWeekEndMs: 0,
  menuOpen: false
};

const elements = {};

document.addEventListener('DOMContentLoaded', init);

function init() {
  bindElements();
  bindEvents();
  updateNow();
  renderFilePathText();
  loadSchedule();

  setInterval(() => {
    updateNow();
    renderDerivedState();
  }, 1000);
}

function bindElements() {
  elements.filePathText = document.getElementById('filePathText');
  elements.currentDate = document.getElementById('currentDate');
  elements.prevWeekBtn = document.getElementById('prevWeekBtn');
  elements.currentWeekBtn = document.getElementById('currentWeekBtn');
  elements.nextWeekBtn = document.getElementById('nextWeekBtn');
  elements.menuToggleBtn = document.getElementById('menuToggleBtn');
  elements.topMenuPanel = document.getElementById('topMenuPanel');
  elements.selectFileBtn = document.getElementById('selectFileBtn');
  elements.reloadBtn = document.getElementById('reloadBtn');
  elements.openFolderBtn = document.getElementById('openFolderBtn');
  elements.statusBanner = document.getElementById('statusBanner');
  elements.weekGrid = document.getElementById('weekGrid');
}

function bindEvents() {
  elements.prevWeekBtn.addEventListener('click', () => {
    shiftViewingWeek(-1);
  });

  elements.nextWeekBtn.addEventListener('click', () => {
    shiftViewingWeek(1);
  });

  elements.currentWeekBtn.addEventListener('click', () => {
    resetViewingWeekToToday();
  });

  elements.menuToggleBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    setMenuOpen(!state.menuOpen);
  });

  elements.topMenuPanel.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  elements.selectFileBtn.addEventListener('click', async () => {
    await chooseScheduleFile();
    setMenuOpen(false);
  });

  elements.reloadBtn.addEventListener('click', () => {
    loadSchedule();
    setMenuOpen(false);
  });

  elements.openFolderBtn.addEventListener('click', async () => {
    try {
      const result = await window.scheduleApi.openScheduleFolder();
      if (!result.ok) {
        showStatus(result.message || '无法打开目录。', 'error', result.details);
      }
    } catch (error) {
      showStatus('打开目录失败。', 'error', error?.message || String(error));
    }

    setMenuOpen(false);
  });

  document.addEventListener('click', () => {
    if (state.menuOpen) {
      setMenuOpen(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.menuOpen) {
      setMenuOpen(false);
    }
  });
}

function updateNow() {
  state.now = new Date();
}

function setMenuOpen(nextOpen) {
  state.menuOpen = nextOpen;
  elements.menuToggleBtn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
  elements.topMenuPanel.classList.toggle('hidden', !nextOpen);
}

function shiftViewingWeek(weekDelta) {
  state.viewDate = addDays(state.viewDate, weekDelta * 7);
  renderAll();
}

function resetViewingWeekToToday() {
  state.viewDate = new Date(state.now.getTime());
  renderAll();
}

function isViewingCurrentWeek() {
  const viewWeek = getWeekRange(state.viewDate);
  return isWithinRange(state.now, viewWeek.start, viewWeek.end);
}

function renderWeekSwitchState() {
  const onCurrentWeek = isViewingCurrentWeek();
  if (elements.currentWeekBtn) {
    elements.currentWeekBtn.disabled = onCurrentWeek;
  }
}

async function loadSchedule() {
  try {
    const savedPath = await window.scheduleApi.getScheduleFilePath();
    state.filePath = savedPath || '';
    renderFilePathText();

    if (!state.filePath) {
      state.rawEvents = [];
      state.occurrences = [];
      state.loadError = null;
      renderAll();
      setStatus('尚未选择课表文件，请从右上角三点菜单选择 .ics 文件。', 'info');
      return;
    }

    setStatus('正在读取课表文件...', 'info');
    const fileResult = await window.scheduleApi.readScheduleFile();

    if (!fileResult.ok) {
      state.rawEvents = [];
      state.occurrences = [];
      state.loadError = fileResult.message || '读取课表失败。';
      state.filePath = fileResult.filePath || state.filePath;
      renderFilePathText();
      renderAll();
      showStatus(state.loadError, 'error', fileResult.details || '');
      return;
    }

    state.filePath = fileResult.filePath || state.filePath;
    renderFilePathText();
    state.rawEvents = parseIcsFile(fileResult.content || '');
    state.occurrences = expandOccurrences(state.rawEvents);
    state.loadError = null;

    renderAll();
    showStatus(`已加载 ${state.rawEvents.length} 条课表事件`, 'success');
  } catch (error) {
    state.rawEvents = [];
    state.occurrences = [];
    state.loadError = error?.message || '读取课表失败。';
    renderAll();
    showStatus('读取课表失败。', 'error', state.loadError);
  }
}

async function chooseScheduleFile() {
  try {
    const result = await window.scheduleApi.selectScheduleFile();

    if (!result || !result.ok) {
      if (result && result.canceled) {
        return;
      }

      showStatus(result?.message || '选择课表文件失败。', 'error', result?.details || '');
      return;
    }

    await loadSchedule();
  } catch (error) {
    showStatus('选择课表文件失败。', 'error', error?.message || String(error));
  }
}

function renderFilePathText() {
  elements.filePathText.textContent = state.filePath
    ? `课表路径：${state.filePath}`
    : '课表路径：尚未选择课表文件';
}

function renderAll() {
  renderClockInfo();
  renderWeekGrid();
  renderWeekSwitchState();
}

function renderDerivedState() {
  renderClockInfo();
  renderWeekSwitchState();
  renderWeekGridHighlights();
}

function renderClockInfo() {
  elements.currentDate.textContent = formatDateLong(state.viewDate);
}

function renderWeekGrid() {
  if (!elements.weekGrid) {
    return;
  }

  const weekRange = getWeekRange(state.viewDate);
  const weekOccurrences = state.occurrences
    .filter((occurrence) => isWithinRange(occurrence.start, weekRange.start, weekRange.end))
    .sort((left, right) => left.start - right.start);
  const onCurrentWeek = isViewingCurrentWeek();

  state.renderedWeekStartMs = weekRange.start.getTime();
  state.renderedWeekEndMs = weekRange.end.getTime();

  elements.weekGrid.innerHTML = '';

  const grid = document.createElement('div');
  grid.className = 'week-grid';
  elements.weekGrid.appendChild(grid);

  const currentColumn = onCurrentWeek ? getWeekColumnFromDay(state.now.getDay()) : 0;

  const corner = createCell('corner-cell', '节次');
  corner.style.gridColumn = '1';
  corner.style.gridRow = '1';
  grid.appendChild(corner);

  for (let index = 0; index < 7; index += 1) {
    const date = addDays(weekRange.start, index);
    const column = index + 2;
    const header = document.createElement('div');
    header.className = `day-header${currentColumn === column ? ' is-today' : ''}`;
    header.style.gridColumn = String(column);
    header.style.gridRow = '1';
    header.dataset.dayColumn = String(column);
    header.innerHTML = `
      <span>周${WEEKDAY_SHORT[index]}</span>
      <small>${date.getMonth() + 1}/${date.getDate()}</small>
    `;
    grid.appendChild(header);
  }

  for (let periodIndex = 1; periodIndex <= PERIODS.length; periodIndex += 1) {
    const period = PERIODS[periodIndex - 1];

    const label = document.createElement('div');
    label.className = 'period-label';
    label.style.gridColumn = '1';
    label.style.gridRow = String(periodIndex + 1);
    label.innerHTML = `
      <span>第${period.index}节</span>
      <small>${period.start}-${period.end}</small>
    `;
    grid.appendChild(label);

    for (let dayColumn = 2; dayColumn <= 8; dayColumn += 1) {
      const cell = document.createElement('div');
      const classNames = ['week-cell'];
      if (dayColumn === currentColumn) {
        classNames.push('is-today');
      }
      cell.className = classNames.join(' ');
      cell.style.gridColumn = String(dayColumn);
      cell.style.gridRow = String(periodIndex + 1);
      cell.dataset.dayColumn = String(dayColumn);
      grid.appendChild(cell);
    }
  }

  weekOccurrences.forEach((occurrence) => {
    const startPeriod = Math.max(1, occurrence.periodStart);
    const endPeriod = Math.min(PERIODS.length, occurrence.periodEnd);
    const span = Math.max(1, endPeriod - startPeriod + 1);

    const card = document.createElement('div');
    const color = getCourseColor(occurrence.summary || occurrence.location || '课程');
    const isCurrent = onCurrentWeek && isOccurrenceActive(occurrence, state.now);
    const tightClass = span <= 2 ? ' tight' : '';

    card.className = `course-card${isCurrent ? ' is-current' : ''}${tightClass}`;
    card.style.gridColumn = String(getWeekColumnFromDay(occurrence.weekday));
    card.style.gridRow = `${startPeriod + 1} / span ${span}`;
    card.style.setProperty('--course-bg', color.bg);
    card.style.setProperty('--course-border', color.border);
    card.dataset.startMs = String(occurrence.start.getTime());
    card.dataset.endMs = String(occurrence.end.getTime());
    card.title = buildOccurrenceTooltip(occurrence);

    const weekNote = occurrence.weekRuleText ? `<div class="course-note">${escapeHtml(occurrence.weekRuleText)}</div>` : '';
    card.innerHTML = `
      <div class="course-title">${escapeHtml(occurrence.summary || '未命名课程')}</div>
      ${occurrence.location ? `<div class="course-location">${escapeHtml(occurrence.location)}</div>` : ''}
      ${weekNote}
    `;

    grid.appendChild(card);
  });
}

function renderWeekGridHighlights() {
  if (!elements.weekGrid) {
    return;
  }

  const onCurrentWeek = isViewingCurrentWeek();
  const currentColumn = onCurrentWeek ? getWeekColumnFromDay(state.now.getDay()) : 0;

  const headerNodes = elements.weekGrid.querySelectorAll('.day-header');
  const cellNodes = elements.weekGrid.querySelectorAll('.week-cell');
  const classNodes = elements.weekGrid.querySelectorAll('.course-card');

  headerNodes.forEach((node) => {
    const col = Number(node.dataset.dayColumn || '0');
    node.classList.toggle('is-today', onCurrentWeek && col === currentColumn);
  });

  cellNodes.forEach((node) => {
    const col = Number(node.dataset.dayColumn || '0');
    node.classList.toggle('is-today', onCurrentWeek && col === currentColumn);
  });

  classNodes.forEach((node) => {
    const startMs = Number(node.dataset.startMs || '0');
    const endMs = Number(node.dataset.endMs || '0');
    node.classList.toggle('is-current', onCurrentWeek && startMs <= state.now.getTime() && endMs > state.now.getTime());
  });
}

function parseIcsFile(content) {
  const lines = unfoldIcsLines(content);
  const events = [];
  let currentEvent = null;
  let nestedDepth = 0;

  for (const line of lines) {
    if (line.startsWith('BEGIN:')) {
      const componentName = line.slice(6).trim().toUpperCase();
      if (componentName === 'VEVENT') {
        currentEvent = [];
        nestedDepth = 0;
      } else if (currentEvent) {
        nestedDepth += 1;
      }
      continue;
    }

    if (line.startsWith('END:')) {
      const componentName = line.slice(4).trim().toUpperCase();
      if (componentName === 'VEVENT' && currentEvent) {
        const event = buildEvent(currentEvent);
        if (event) {
          events.push(event);
        }
        currentEvent = null;
        nestedDepth = 0;
      } else if (currentEvent && nestedDepth > 0) {
        nestedDepth -= 1;
      }
      continue;
    }

    if (currentEvent && nestedDepth === 0) {
      currentEvent.push(line);
    }
  }

  return events;
}

function buildEvent(lines) {
  const event = {
    summary: '',
    location: '',
    description: '',
    rrule: '',
    start: null,
    end: null,
    periodText: '',
    periodStart: 1,
    periodEnd: 1,
    weekRuleText: '',
    weekday: 1
  };

  for (const line of lines) {
    const parsed = parsePropertyLine(line);
    if (!parsed) {
      continue;
    }

    switch (parsed.name) {
      case 'SUMMARY':
        event.summary = parsed.value;
        break;
      case 'LOCATION':
        event.location = parsed.value;
        break;
      case 'DESCRIPTION':
        event.description = parsed.value;
        break;
      case 'RRULE':
        event.rrule = parsed.value;
        break;
      case 'DTSTART':
        event.start = parseIcsDate(parsed.value);
        break;
      case 'DTEND':
        event.end = parseIcsDate(parsed.value);
        break;
      default:
        break;
    }
  }

  if (!event.start || !event.end) {
    return null;
  }

  const explicitPeriod = extractPeriodText(event.description || `${event.summary} ${event.location}`);
  const periodRange = explicitPeriod || inferPeriodRange(event.start, event.end);
  event.periodStart = periodRange.start;
  event.periodEnd = periodRange.end;
  event.periodText = periodRange.label;
  event.weekday = event.start.getDay();
  event.weekRuleText = extractWeekRuleText(event.description || '') || '';

  return event;
}

function expandOccurrences(events) {
  const occurrences = [];

  for (const event of events) {
    const rule = parseRRule(event.rrule);

    if (!rule || rule.freq !== 'WEEKLY') {
      occurrences.push(createOccurrence(event, event.start, event.end));
      continue;
    }

    const until = rule.until || addWeeks(event.start, 20);
    const intervalWeeks = Math.max(1, rule.interval || 1);
    let cursorStart = new Date(event.start.getTime());
    let cursorEnd = new Date(event.end.getTime());

    while (cursorStart <= until) {
      occurrences.push(createOccurrence(event, cursorStart, cursorEnd));
      cursorStart = addDays(cursorStart, intervalWeeks * 7);
      cursorEnd = addDays(cursorEnd, intervalWeeks * 7);
    }
  }

  return occurrences.sort((left, right) => left.start - right.start);
}

function createOccurrence(event, start, end) {
  const periodRange = getPeriodRangeFromTimes(start, end);
  const periodText = periodRange.label || event.periodText || `第${periodRange.start}${periodRange.end > periodRange.start ? `-${periodRange.end}` : ''}节`;

  return {
    ...event,
    start: new Date(start.getTime()),
    end: new Date(end.getTime()),
    weekday: start.getDay(),
    periodStart: periodRange.start,
    periodEnd: periodRange.end,
    periodText
  };
}

function parsePropertyLine(line) {
  const colonIndex = line.indexOf(':');
  if (colonIndex === -1) {
    return null;
  }

  const head = line.slice(0, colonIndex);
  const rawValue = line.slice(colonIndex + 1);
  const segments = head.split(';');
  const name = segments.shift().toUpperCase();
  const params = {};

  segments.forEach((segment) => {
    const equalIndex = segment.indexOf('=');
    if (equalIndex === -1) {
      params[segment.toUpperCase()] = true;
      return;
    }

    const key = segment.slice(0, equalIndex).toUpperCase();
    const value = segment.slice(equalIndex + 1);
    params[key] = decodeIcsText(value);
  });

  return {
    name,
    params,
    value: decodeIcsText(rawValue)
  };
}

function parseIcsDate(value) {
  const cleaned = value.trim();

  if (/^\d{8}$/.test(cleaned)) {
    const year = Number(cleaned.slice(0, 4));
    const month = Number(cleaned.slice(4, 6)) - 1;
    const day = Number(cleaned.slice(6, 8));
    return new Date(year, month, day, 0, 0, 0, 0);
  }

  const match = cleaned.match(/^(\d{8})T(\d{6})(Z?)$/);
  if (!match) {
    return new Date(cleaned);
  }

  const datePart = match[1];
  const timePart = match[2];
  const isUtc = match[3] === 'Z';
  const year = Number(datePart.slice(0, 4));
  const month = Number(datePart.slice(4, 6)) - 1;
  const day = Number(datePart.slice(6, 8));
  const hour = Number(timePart.slice(0, 2));
  const minute = Number(timePart.slice(2, 4));
  const second = Number(timePart.slice(4, 6));

  if (isUtc) {
    return new Date(Date.UTC(year, month, day, hour, minute, second, 0));
  }

  return new Date(year, month, day, hour, minute, second, 0);
}

function parseRRule(rruleText) {
  if (!rruleText) {
    return null;
  }

  const rule = {};
  rruleText.split(';').forEach((chunk) => {
    const [key, value = ''] = chunk.split('=');
    rule[key.toUpperCase()] = value;
  });

  return {
    freq: rule.FREQ || '',
    interval: Number(rule.INTERVAL || '1'),
    until: rule.UNTIL ? parseIcsDate(rule.UNTIL) : null
  };
}

function unfoldIcsLines(content) {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const unfolded = [];

  lines.forEach((line) => {
    if (/^[ \t]/.test(line) && unfolded.length) {
      unfolded[unfolded.length - 1] += line.slice(1);
      return;
    }

    unfolded.push(line);
  });

  return unfolded.filter((line) => line.trim().length > 0);
}

function decodeIcsText(text) {
  return String(text)
    .replace(/\\n/gi, '\n')
    .replace(/\\N/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function extractPeriodText(text) {
  const matchRange = String(text).match(/第\s*(\d+)\s*[-~至到—–]\s*(\d+)\s*节/);
  if (matchRange) {
    return {
      start: Number(matchRange[1]),
      end: Number(matchRange[2]),
      label: `第${Number(matchRange[1])}-${Number(matchRange[2])}节`
    };
  }

  const matchSingle = String(text).match(/第\s*(\d+)\s*节/);
  if (matchSingle) {
    const period = Number(matchSingle[1]);
    return {
      start: period,
      end: period,
      label: `第${period}节`
    };
  }

  return null;
}

function extractWeekRuleText(text) {
  const stringText = String(text);

  if (/单周/.test(stringText)) {
    return '单周';
  }
  if (/双周/.test(stringText)) {
    return '双周';
  }

  const match = stringText.match(/第\s*([0-9,\-、至到\s]+)周/);
  if (match) {
    return `第${match[1].replace(/\s+/g, '')}周`;
  }

  return '';
}

function inferPeriodRange(start, end) {
  const startMinutes = minutesFromDate(start);
  const endMinutes = minutesFromDate(end);
  const overlappingPeriods = PERIODS.filter((period) => {
    const periodStart = timeToMinutes(period.start);
    const periodEnd = timeToMinutes(period.end);
    return startMinutes < periodEnd && endMinutes > periodStart;
  });

  if (overlappingPeriods.length) {
    const first = overlappingPeriods[0].index;
    const last = overlappingPeriods[overlappingPeriods.length - 1].index;
    return {
      start: first,
      end: last,
      label: first === last ? `第${first}节` : `第${first}-${last}节`
    };
  }

  const fallbackStart = findClosestPeriodIndex(startMinutes);
  return {
    start: fallbackStart,
    end: fallbackStart,
    label: `第${fallbackStart}节`
  };
}

function getPeriodRangeFromTimes(start, end) {
  const startMinutes = minutesFromDate(start);
  const endMinutes = minutesFromDate(end);
  const overlapping = PERIODS.filter((period) => {
    const periodStart = timeToMinutes(period.start);
    const periodEnd = timeToMinutes(period.end);
    return startMinutes < periodEnd && endMinutes > periodStart;
  });

  if (overlapping.length) {
    const first = overlapping[0].index;
    const last = overlapping[overlapping.length - 1].index;
    return {
      start: first,
      end: last,
      label: first === last ? `第${first}节` : `第${first}-${last}节`
    };
  }

  const fallbackStart = findClosestPeriodIndex(startMinutes);
  return {
    start: fallbackStart,
    end: fallbackStart,
    label: `第${fallbackStart}节`
  };
}

function findClosestPeriodIndex(minutes) {
  let closest = PERIODS[0].index;
  let smallestDiff = Number.POSITIVE_INFINITY;

  PERIODS.forEach((period) => {
    const periodStart = timeToMinutes(period.start);
    const diff = Math.abs(minutes - periodStart);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      closest = period.index;
    }
  });

  return closest;
}

function getWeekColumnFromDay(dayNumber) {
  return dayNumber === 0 ? 8 : dayNumber + 1;
}

function isOccurrenceActive(occurrence, now) {
  return occurrence.start <= now && occurrence.end > now;
}

function buildOccurrenceTooltip(occurrence) {
  const bits = [occurrence.summary || '未命名课程'];
  bits.push(`${formatDateShort(occurrence.start)} ${formatTime(occurrence.start)}-${formatTime(occurrence.end)}`);

  if (occurrence.location) {
    bits.push(occurrence.location);
  }
  if (occurrence.periodText) {
    bits.push(occurrence.periodText);
  }
  if (occurrence.weekRuleText) {
    bits.push(occurrence.weekRuleText);
  }

  return bits.join(' · ');
}

function createCell(className, text) {
  const cell = document.createElement('div');
  cell.className = className;
  cell.textContent = text;
  return cell;
}

function getWeekRange(date) {
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = startOfDay(addDays(date, mondayOffset));
  const end = endOfDay(addDays(start, 6));
  return { start, end };
}

function isWithinRange(date, start, end) {
  return date >= start && date <= end;
}

function isSameDay(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

function addWeeks(date, weeks) {
  return addDays(date, weeks * 7);
}

function minutesFromDate(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function timeToMinutes(value) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function formatDateLong(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatDateShort(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatTime(date) {
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

function getCourseColor(key) {
  const hash = hashString(key);
  const hue = hash % 360;
  const saturation = 66;
  const bgLightness = 28 + (hash % 8);
  const borderLightness = 49 + (hash % 10);

  return {
    bg: `hsla(${hue}, ${saturation}%, ${bgLightness}%, 0.76)`,
    border: `hsla(${hue}, ${saturation + 8}%, ${borderLightness}%, 0.48)`
  };
}

function hashString(text) {
  const value = String(text);
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function renderStatusText(message, type = 'info', detail = '') {
  elements.statusBanner.textContent = detail ? `${message} ${detail}` : message;
  elements.statusBanner.className = `status-banner ${type}`;
  elements.statusBanner.classList.remove('hidden');
}

function showStatus(message, type = 'info', detail = '') {
  renderStatusText(message, type, detail);
  window.clearTimeout(showStatus._timer);
  showStatus._timer = window.setTimeout(() => {
    elements.statusBanner.classList.add('hidden');
  }, type === 'error' ? 8000 : 3500);
}

function setStatus(message, type = 'info') {
  renderStatusText(message, type);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
