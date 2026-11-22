/**
 * 温度采样导入解析器
 *
 * 支持三种输入格式，自动识别：
 *
 * 1) 长表 CSV —— 每个采样点一行：
 *      rack_id,row,col,facing,face,x,y,temp
 *      R01,0,0,+Z,intake,0,0,23.4
 *
 * 2) 宽表 CSV —— 每个机柜每个面一行，温度读数按顺序填在尾部列：
 *      rack_id,row,col,facing,face,v0,v1,...,v35
 *
 * 3) JSON —— 数组，元素同上述字段的键值对。
 *
 * 字段别名（大小写、空格、下划线不敏感）：
 *   rack_id: rack, rackid, id, 机柜, 机柜编号, 编号
 *   row:     row, r, 行
 *   col:     col, column, c, 列
 *   facing:  facing, direction, dir, face, orientation, 朝向, 方向, 面向
 *   face:    side, facekind, surface, 面, 风面, 进风面
 *   x:       x, i, cx, colidx, 横向
 *   y:       y, j, cy, rowidx, 纵向
 *   temp:    temp, temperature, t, value, celsius, ℃, 温度, 读数
 *
 * 缺失值写空、`-`、`NA`、`nan` 均可。
 */

import {
  FACE_COLS,
  FACE_ROWS,
  MAX_RACKS,
  MAX_SAMPLES_PER_FACE,
  type FacingDir,
  type FaceKind,
  type Rack,
  type RackSampleGrid,
} from "../model/types";

export interface ParseIssue {
  severity: "error" | "warning";
  message: string;
  /** 原始行号（1 起；0 表示非表格来源） */
  line?: number;
}

export interface ParseResult {
  racks: Rack[];
  issues: ParseIssue[];
  /** 识别出的输入格式 */
  format: "long-csv" | "wide-csv" | "json" | "unknown";
  /** 解析出的采样点总数 */
  sampleCount: number;
}

const ALIASES: Record<string, string[]> = {
  rack_id: ["rack_id", "rackid", "rack", "id", "cabinet", "cabinetid", "机柜", "机柜编号", "编号", "设备编号"],
  row: ["row", "r", "rowindex", "行", "行号", "排"],
  col: ["col", "column", "c", "colindex", "列", "列号"],
  facing: ["facing", "direction", "dir", "orientation", "orient", "朝向", "方向", "面向", "进风朝向"],
  face: ["face", "side", "facekind", "surface", "面", "风面", "进风面", "风侧面"],
  x: ["x", "i", "cx", "colidx", "colpos", "横向", "横坐标"],
  y: ["y", "j", "cy", "rowidx", "rowpos", "纵向", "纵坐标"],
  temp: ["temp", "temperature", "t", "value", "celsius", "celcius", "℃", "温度", "读数", "温度值"],
};

function normaliseKey(k: string): string {
  return k
    .trim()
    .toLowerCase()
    .replace(/[\s_\-()（）]+/g, "")
    .replace(/°c|\(℃\)|（℃）/g, "");
}

function buildReverseAlias(): Map<string, string> {
  const map = new Map<string, string>();
  for (const [canonical, list] of Object.entries(ALIASES)) {
    for (const a of list) {
      map.set(normaliseKey(a), canonical);
    }
  }
  return map;
}

const REVERSE_ALIAS = buildReverseAlias();

/** 把原始表头映射到规范字段名；无法识别返回 null */
export function canonicalField(raw: string): string | null {
  const key = normaliseKey(raw);
  if (REVERSE_ALIAS.has(key)) return REVERSE_ALIAS.get(key)!;
  // 宽表 v0..v35 / c0r0 之类，交给调用方识别
  return null;
}

export function parseFacing(raw: unknown): FacingDir | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return null;
  switch (s) {
    case "+Z":
    case "Z+":
    case "Z":
    case "北":
    case "NORTH":
    case "FRONT":
      return "+Z";
    case "-Z":
    case "Z-":
    case "南":
    case "SOUTH":
    case "BACK":
      return "-Z";
    case "+X":
    case "X+":
    case "X":
    case "东":
    case "EAST":
    case "RIGHT":
      return "+X";
    case "-X":
    case "X-":
    case "西":
    case "WEST":
    case "LEFT":
      return "-X";
    default:
      return null;
  }
}

export function parseFaceKind(raw: unknown): FaceKind | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw)
    .trim()
    .toLowerCase()
    .replace(/[\s_\-]+/g, "");
  if (!s) return null;
  if (["intake", "in", "cold", "front", "进风", "进风面", "冷通道", "前面"].includes(s)) return "intake";
  if (["exhaust", "out", "hot", "rear", "back", "出风", "出风面", "热通道", "后面"].includes(s)) return "exhaust";
  return null;
}

const MISSING = new Set(["", "-", "--", "na", "n/a", "nan", "null", "none", "?", "无"]);

export function parseTemp(raw: unknown): number {
  if (raw === undefined || raw === null) return NaN;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : NaN;
  const s = String(raw).trim().toLowerCase();
  if (MISSING.has(s)) return NaN;
  // 去掉常见单位后缀
  const cleaned = s.replace(/℃|°c|度|degc?/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

export function parseIndex(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // 支持 "0"、"R0"、"行3" 等
  const m = s.match(/-?\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isInteger(n) ? n : null;
}

/* ------------------------------------------------------------------ */
/*  CSV 切分                                                            */
/* ------------------------------------------------------------------ */

/** 按逗号/制表符/分号切分一行，支持双引号包裹。自动判定分隔符。 */
export function detectDelimiter(sampleLines: string[]): string {
  const candidates = [",", "\t", ";", "|"];
  let best = ",";
  let bestScore = -1;
  for (const d of candidates) {
    // 用一致性评分：拆分后列数稳定且 >1 的行越多越好
    const counts = sampleLines
      .filter((l) => l.trim())
      .slice(0, 20)
      .map((l) => splitCsvLine(l, d).length);
    if (counts.length === 0) continue;
    const mode = counts.slice().sort((a, b) => a - b)[Math.floor(counts.length / 2)];
    if (mode < 2) continue;
    const stable = counts.filter((c) => c === mode).length / counts.length;
    const score = stable * 100 + mode;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

export function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** 把整段 CSV 切成行（处理引号内的换行）。返回的行带 1 起原始终行号。 */
function splitCsvRecords(text: string): { line: string; lineNo: number }[] {
  const out: { line: string; lineNo: number }[] = [];
  let cur = "";
  let inQuotes = false;
  let lineNo = 1;
  let recStart = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      cur += ch;
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      out.push({ line: cur, lineNo: recStart });
      cur = "";
      lineNo++;
      recStart = lineNo;
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) out.push({ line: cur, lineNo: recStart });
  return out;
}

/* ------------------------------------------------------------------ */
/*  构建机柜                                                            */
/* ------------------------------------------------------------------ */

interface RackDraft {
  id: string;
  row: number | null;
  col: number | null;
  facing: FacingDir | null;
  intake: Float32Array;
  intakeSet: Uint8Array;
  exhaust: Float32Array;
  exhaustSet: Uint8Array;
  intakeCount: number;
  exhaustCount: number;
  firstLine: number;
}

function emptyGrid(): RackSampleGrid {
  const values = new Float32Array(FACE_COLS * FACE_ROWS).fill(NaN);
  return { cols: FACE_COLS, rows: FACE_ROWS, values };
}

function makeDraft(id: string, line: number): RackDraft {
  return {
    id,
    row: null,
    col: null,
    facing: null,
    intake: new Float32Array(MAX_SAMPLES_PER_FACE).fill(NaN),
    intakeSet: new Uint8Array(MAX_SAMPLES_PER_FACE),
    exhaust: new Float32Array(MAX_SAMPLES_PER_FACE).fill(NaN),
    exhaustSet: new Uint8Array(MAX_SAMPLES_PER_FACE),
    intakeCount: 0,
    exhaustCount: 0,
    firstLine: line,
  };
}

function finaliseDrafts(
  drafts: Map<string, RackDraft>,
  issues: ParseIssue[],
  autoLayout: boolean,
): Rack[] {
  const racks: Rack[] = [];
  const list = Array.from(drafts.values());

  if (list.length > MAX_RACKS) {
    issues.push({
      severity: "error",
      message: `机柜数量 ${list.length} 超过单机房上限 ${MAX_RACKS}，仅保留前 ${MAX_RACKS} 个。`,
    });
  }

  const kept = list.slice(0, MAX_RACKS);
  // 自动补全行/列：按出现顺序排成一列时的兜底
  const missingPos = kept.filter((d) => d.row === null || d.col === null);
  if (autoLayout && missingPos.length > 0) {
    issues.push({
      severity: "warning",
      message: `${missingPos.length} 个机柜缺少行列位置，已按导入顺序自动排布。`,
    });
  }

  let autoCol = 0;
  let autoRow = 0;
  for (const d of kept) {
    const r = d.row ?? autoRow;
    const c = d.col ?? autoCol;
    autoCol++;
    if (autoCol >= 10) {
      autoCol = 0;
      autoRow++;
    }

    const facing: FacingDir = d.facing ?? "+Z";
    if (d.facing === null) {
      issues.push({
        severity: "warning",
        message: `机柜 ${d.id} 未提供朝向，默认按 +Z（进风面朝 +Z）。`,
        line: d.firstLine,
      });
    }

    const intake = emptyGrid();
    const exhaust = emptyGrid();
    intake.values.set(d.intake);
    exhaust.values.set(d.exhaust);

    const missingCount = (g: Float32Array, s: Uint8Array) => {
      let n = 0;
      for (let i = 0; i < g.length; i++) if (!s[i]) n++;
      return n;
    };
    const mi = missingCount(d.intake, d.intakeSet);
    const me = missingCount(d.exhaust, d.exhaustSet);
    if (mi > 0) {
      issues.push({
        severity: "warning",
        message: `机柜 ${d.id} 进风面有 ${mi} 个采样点缺失，已按邻近插值补全。`,
        line: d.firstLine,
      });
    }
    if (me > 0) {
      issues.push({
        severity: "warning",
        message: `机柜 ${d.id} 出风面有 ${me} 个采样点缺失，已按邻近插值补全。`,
        line: d.firstLine,
      });
    }
    fillMissing(intake.values);
    fillMissing(exhaust.values);

    racks.push({ id: d.id, row: r, col: c, facing, intake, exhaust });
  }

  // 重复的 (row,col) 检测
  const seen = new Map<string, string>();
  for (const r of racks) {
    const key = `${r.row},${r.col}`;
    if (seen.has(key)) {
      issues.push({
        severity: "warning",
        message: `机柜 ${r.id} 与 ${seen.get(key)} 占用同一位置 (行 ${r.row}, 列 ${r.col})。`,
      });
    } else {
      seen.set(key, r.id);
    }
  }

  return racks;
}

/** 用同行/全体的均值填充缺失采样点（无任何读数时用 25℃）。 */
export function fillMissing(values: Float32Array): void {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i])) {
      sum += values[i];
      n++;
    }
  }
  const fallback = n > 0 ? sum / n : 25;
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) values[i] = fallback;
  }
}

/* ------------------------------------------------------------------ */
/*  主入口                                                              */
/* ------------------------------------------------------------------ */

export function parseThermalData(text: string): ParseResult {
  const issues: ParseIssue[] = [];
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      racks: [],
      issues: [{ severity: "error", message: "文件为空。" }],
      format: "unknown",
      sampleCount: 0,
    };
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseJson(trimmed, issues);
  }

  const records = splitCsvRecords(trimmed).filter((r) => r.line.trim().length > 0);
  if (records.length < 2) {
    return {
      racks: [],
      issues: [{ severity: "error", message: "CSV 至少需要一行表头与一行数据。" }],
      format: "unknown",
      sampleCount: 0,
    };
  }
  const delim = detectDelimiter(records.slice(0, 20).map((r) => r.line));
  const header = splitCsvLine(records[0].line, delim);
  return parseTable(header, records.slice(1), delim, issues);
}

function parseTable(
  header: string[],
  dataRecords: { line: string; lineNo: number }[],
  delim: string,
  issues: ParseIssue[],
): ParseResult {
  // 表头 → 字段，以及宽表的 "温度列"
  const fieldAt: (string | null)[] = header.map((h) => canonicalField(h));
  const tempColumns: number[] = [];
  const gridColumns: { index: number; x: number; y: number }[] = [];
  for (let i = 0; i < header.length; i++) {
    const raw = header[i].trim();
    if (fieldAt[i] === null) {
      // 形如 v0 / v12 / t3 / c0r0 / x0y1 的宽表温度列
      const m1 = raw.match(/^[vt](\d+)$/i);
      const m2 = raw.match(/^(?:c|x)(\d+)[_,]?(?:r|y)(\d+)$/i);
      if (m1) {
        const idx = Number(m1[1]);
        if (idx < MAX_SAMPLES_PER_FACE) gridColumns.push({ index: i, x: idx, y: 0 });
      } else if (m2) {
        const x = Number(m2[1]);
        const y = Number(m2[2]);
        if (x < FACE_COLS && y < FACE_ROWS) gridColumns.push({ index: i, x, y });
      }
    }
  }
  // 宽表兜底：表头有 face 字段时，把其余可解析为数字的号码列都当作 v0..v35
  if (gridColumns.length === 0) {
    for (let i = 0; i < header.length; i++) {
      if (fieldAt[i] === null) tempColumns.push(i);
    }
  }

  const requires = ["rack_id"];
  for (const req of requires) {
    if (!fieldAt.includes(req)) {
      return {
        racks: [],
        issues: [{ severity: "error", message: `表头缺少必需字段 "${req}"（可写作 rack / 机柜 / 编号）。` }],
        format: "unknown",
        sampleCount: 0,
      };
    }
  }

  const hasXY = fieldAt.includes("x") && fieldAt.includes("y");
  const hasFace = fieldAt.includes("face");
  const hasTemp = fieldAt.includes("temp");
  const isWide = hasFace && !hasXY && (hasTemp ? gridColumns.length === 0 : true) && (gridColumns.length > 0 || tempColumns.length > 0);
  const isLong = hasXY && hasFace && hasTemp;

  if (!isLong && !isWide) {
    // 再给一次明确提示
    const hint =
      "需要长表（rack_id,row,col,facing,face,x,y,temp）或宽表（rack_id,row,col,facing,face,v0..v35）。";
    return {
      racks: [],
      issues: [{ severity: "error", message: `无法确定表格结构。${hint}` }],
      format: "unknown",
      sampleCount: 0,
    };
  }

  const drafts = new Map<string, RackDraft>();
  let sampleCount = 0;
  const idxOf = (f: string) => fieldAt.indexOf(f);

  const colPos = {
    rack_id: idxOf("rack_id"),
    row: idxOf("row"),
    col: idxOf("col"),
    facing: idxOf("facing"),
    face: idxOf("face"),
    x: idxOf("x"),
    y: idxOf("y"),
    temp: idxOf("temp"),
  };

  for (const rec of dataRecords) {
    const cells = splitCsvLine(rec.line, delim);
    if (cells.length === 0) continue;
    const get = (i: number): string => (i >= 0 && i < cells.length ? cells[i] : "");

    const idRaw = get(colPos.rack_id);
    const id = idRaw.trim();
    if (!id) {
      issues.push({ severity: "warning", message: "跳过缺少机柜编号的行。", line: rec.lineNo });
      continue;
    }
    let draft = drafts.get(id);
    if (!draft) {
      draft = makeDraft(id, rec.lineNo);
      drafts.set(id, draft);
    }
    if (draft.row === null && colPos.row >= 0) draft.row = parseIndex(get(colPos.row));
    if (draft.col === null && colPos.col >= 0) draft.col = parseIndex(get(colPos.col));
    if (draft.facing === null && colPos.facing >= 0) {
      const parsed = parseFacing(get(colPos.facing));
      if (parsed) draft.facing = parsed;
      else if (get(colPos.facing).trim()) {
        issues.push({
          severity: "warning",
          message: `无法识别朝向 "${get(colPos.facing)}"（机柜 ${id}），支持 +X/-X/+Z/-Z。`,
          line: rec.lineNo,
        });
      }
    }
    const face = parseFaceKind(get(colPos.face));
    if (face === null) {
      issues.push({
        severity: "warning",
        message: `无法识别风面 "${get(colPos.face)}"（机柜 ${id}），支持 intake/exhaust。`,
        line: rec.lineNo,
      });
      continue;
    }

    if (isLong) {
      const x = parseIndex(get(colPos.x));
      const y = parseIndex(get(colPos.y));
      const temp = parseTemp(get(colPos.temp));
      if (x === null || y === null) {
        issues.push({ severity: "warning", message: "跳过缺少采样点坐标的行。", line: rec.lineNo });
        continue;
      }
      if (x < 0 || x >= FACE_COLS || y < 0 || y >= FACE_ROWS) {
        issues.push({
          severity: "warning",
          message: `采样点坐标 (${x},${y}) 超出 ${FACE_COLS}x${FACE_ROWS} 栅格，已忽略。`,
          line: rec.lineNo,
        });
        continue;
      }
      const slot = y * FACE_COLS + x;
      writeSample(draft, face, slot, temp);
      if (Number.isFinite(temp)) sampleCount++;
    } else {
      // 宽表
      if (gridColumns.length > 0) {
        for (const gc of gridColumns) {
          const slot = gc.y * FACE_COLS + gc.x;
          const temp = parseTemp(get(gc.index));
          writeSample(draft, face, slot, temp);
          if (Number.isFinite(temp)) sampleCount++;
        }
      } else {
        tempColumns.forEach((ci, k) => {
          if (k >= MAX_SAMPLES_PER_FACE) return;
          const temp = parseTemp(get(ci));
          writeSample(draft, face, k, temp);
          if (Number.isFinite(temp)) sampleCount++;
        });
      }
    }
  }

  if (drafts.size === 0) {
    return {
      racks: [],
      issues: [...issues, { severity: "error", message: "没有解析到任何机柜数据。" }],
      format: isLong ? "long-csv" : "wide-csv",
      sampleCount: 0,
    };
  }

  return {
    racks: finaliseDrafts(drafts, issues, true),
    issues,
    format: isLong ? "long-csv" : "wide-csv",
    sampleCount,
  };
}

function writeSample(draft: RackDraft, face: FaceKind, slot: number, temp: number): void {
  if (slot < 0 || slot >= MAX_SAMPLES_PER_FACE) return;
  if (face === "intake") {
    if (Number.isFinite(temp)) {
      draft.intake[slot] = temp;
      draft.intakeSet[slot] = 1;
      draft.intakeCount++;
    }
  } else {
    if (Number.isFinite(temp)) {
      draft.exhaust[slot] = temp;
      draft.exhaustSet[slot] = 1;
      draft.exhaustCount++;
    }
  }
}

function parseJson(text: string, issues: ParseIssue[]): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return {
      racks: [],
      issues: [{ severity: "error", message: `JSON 解析失败：${(e as Error).message}` }],
      format: "json",
      sampleCount: 0,
    };
  }

  // 支持 { racks: [...] } 或直接数组
  let list: any[];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === "object" && Array.isArray((raw as any).racks)) {
    list = (raw as any).racks;
  } else {
    return {
      racks: [],
      issues: [{ severity: "error", message: "JSON 需要是对象数组，或包含 racks 数组的对象。" }],
      format: "json",
      sampleCount: 0,
    };
  }

  const drafts = new Map<string, RackDraft>();
  let sampleCount = 0;

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, any>;
    const idRaw = obj.rack_id ?? obj.rackId ?? obj.rack ?? obj.id ?? obj["机柜编号"] ?? obj["编号"];
    const id = idRaw === undefined || idRaw === null ? "" : String(idRaw).trim();
    if (!id) {
      issues.push({ severity: "warning", message: `第 ${i + 1} 个 JSON 条目缺少机柜编号。` });
      continue;
    }
    let draft = drafts.get(id);
    if (!draft) {
      draft = makeDraft(id, 0);
      drafts.set(id, draft);
    }
    draft.row ??= parseIndex(obj.row ?? obj["行"]);
    draft.col ??= parseIndex(obj.col ?? obj.column ?? obj["列"]);
    draft.facing ??= parseFacing(obj.facing ?? obj.direction ?? obj["朝向"]);

    // 两种结构：
    //  a) { intake: [[..6..]..], exhaust: [[..]] }
    //  b) { intake: [36], exhaust: [36] }
    for (const face of ["intake", "exhaust"] as FaceKind[]) {
      const src = obj[face] ?? obj[face === "intake" ? "进风" : "出风"];
      if (src === undefined || src === null) continue;
      const flat = flattenFaceValues(src);
      for (let s = 0; s < MAX_SAMPLES_PER_FACE; s++) {
        writeSample(draft, face, s, flat[s] ?? NaN);
        if (Number.isFinite(flat[s])) sampleCount++;
      }
    }
  }

  if (drafts.size === 0) {
    return {
      racks: [],
      issues: [...issues, { severity: "error", message: "JSON 中没有解析到任何机柜。" }],
      format: "json",
      sampleCount: 0,
    };
  }

  return { racks: finaliseDrafts(drafts, issues, true), issues, format: "json", sampleCount };
}

/** 把嵌套数组或扁平数组统一成按行优先展开的 36 长度数组。 */
function flattenFaceValues(src: unknown): number[] {
  const out: number[] = [];
  if (!Array.isArray(src)) return out;
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
    } else {
      out.push(parseTemp(node));
    }
  };
  walk(src);
  return out;
}
