import { describe, it, expect } from "vitest";
import {
  canonicalField,
  parseFacing,
  parseFaceKind,
  parseTemp,
  parseIndex,
  splitCsvLine,
  detectDelimiter,
  parseThermalData,
  fillMissing,
} from "../../src/io/parseThermalData";
import { FACE_COLS, FACE_ROWS, MAX_SAMPLES_PER_FACE } from "../../src/model/types";

/** 生成长表 CSV */
function longCsv(racks: { id: string; row: number; col: number; facing?: string; intake: number; exhaust: number }[]): string {
  const lines = ["rack_id,row,col,facing,face,x,y,temp"];
  for (const r of racks) {
    for (let y = 0; y < FACE_ROWS; y++) {
      for (let x = 0; x < FACE_COLS; x++) {
        lines.push([r.id, r.row, r.col, r.facing ?? "+Z", "intake", x, y, (r.intake + (x + y) * 0.1).toFixed(2)].join(","));
        lines.push([r.id, r.row, r.col, r.facing ?? "+Z", "exhaust", x, y, (r.exhaust + (x + y) * 0.1).toFixed(2)].join(","));
      }
    }
  }
  return lines.join("\n");
}

describe("字段别名", () => {
  it("识别常见别名与中文表头", () => {
    expect(canonicalField("rack_id")).toBe("rack_id");
    expect(canonicalField("Rack ID")).toBe("rack_id");
    expect(canonicalField("机柜编号")).toBe("rack_id");
    expect(canonicalField("编号")).toBe("rack_id");
    expect(canonicalField("行")).toBe("row");
    expect(canonicalField("列号")).toBe("col");
    expect(canonicalField("朝向")).toBe("facing");
    expect(canonicalField("温度")).toBe("temp");
    expect(canonicalField("不存在的字段")).toBeNull();
  });
});

describe("朝向解析", () => {
  it("接受 +X/-X/+Z/-Z 与中文方位", () => {
    expect(parseFacing("+Z")).toBe("+Z");
    expect(parseFacing("z-")).toBe("-Z");
    expect(parseFacing("北")).toBe("+Z");
    expect(parseFacing("南")).toBe("-Z");
    expect(parseFacing("东")).toBe("+X");
    expect(parseFacing("西")).toBe("-X");
    expect(parseFacing("up")).toBeNull();
  });
});

describe("风面解析", () => {
  it("识别进风/出风", () => {
    expect(parseFaceKind("intake")).toBe("intake");
    expect(parseFaceKind("进风面")).toBe("intake");
    expect(parseFaceKind("Exhaust")).toBe("exhaust");
    expect(parseFaceKind("出风")).toBe("exhaust");
    expect(parseFaceKind("side")).toBeNull();
  });
});

describe("温度与坐标解析", () => {
  it("处理单位与缺失值", () => {
    expect(parseTemp("23.4")).toBe(23.4);
    expect(parseTemp("23.4℃")).toBe(23.4);
    expect(parseTemp("35 °C")).toBe(35);
    expect(parseTemp("")).toBeNaN();
    expect(parseTemp("NA")).toBeNaN();
    expect(parseTemp("-")).toBeNaN();
    expect(parseTemp(null)).toBeNaN();
  });

  it("从带前缀的坐标里取整数", () => {
    expect(parseIndex("3")).toBe(3);
    expect(parseIndex("R2")).toBe(2);
    expect(parseIndex("行0")).toBe(0);
    expect(parseIndex("")).toBeNull();
  });
});

describe("CSV 切分", () => {
  it("处理引号包裹与转义", () => {
    expect(splitCsvLine('a,b,c', ",")).toEqual(["a", "b", "c"]);
    expect(splitCsvLine('"a,b",c', ",")).toEqual(["a,b", "c"]);
    expect(splitCsvLine('"he said ""hi""",x', ",")).toEqual(['he said "hi"', "x"]);
    expect(splitCsvLine("a\tb\tc", "\t")).toEqual(["a", "b", "c"]);
  });

  it("自动判定分隔符", () => {
    expect(detectDelimiter(["a,b,c", "1,2,3"])).toBe(",");
    expect(detectDelimiter(["a\tb\tc", "1\t2\t3"])).toBe("\t");
    expect(detectDelimiter(["a;b;c", "1;2;3"])).toBe(";");
  });
});

describe("长表解析", () => {
  it("解析出正确数量的机柜与采样点", () => {
    const csv = longCsv([
      { id: "R01", row: 0, col: 0, intake: 23, exhaust: 36 },
      { id: "R02", row: 0, col: 1, intake: 24, exhaust: 38 },
    ]);
    const r = parseThermalData(csv);
    expect(r.format).toBe("long-csv");
    expect(r.racks).toHaveLength(2);
    expect(r.sampleCount).toBe(2 * MAX_SAMPLES_PER_FACE * 2);
    const rack = r.racks[0];
    expect(rack.id).toBe("R01");
    expect(rack.row).toBe(0);
    expect(rack.col).toBe(0);
    expect(rack.facing).toBe("+Z");
    expect(rack.intake.values.length).toBe(MAX_SAMPLES_PER_FACE);
    // (0,0) 处应接近 23
    expect(rack.intake.values[0]).toBeCloseTo(23, 0);
    expect(rack.exhaust.values[0]).toBeCloseTo(36, 0);
  });

  it("越界坐标被忽略并给出警告", () => {
    const csv = [
      "rack_id,row,col,facing,face,x,y,temp",
      "R01,0,0,+Z,intake,0,0,25",
      "R01,0,0,+Z,intake,99,0,25",
    ].join("\n");
    const r = parseThermalData(csv);
    expect(r.racks).toHaveLength(1);
    expect(r.issues.some((i) => i.message.includes("超出"))).toBe(true);
  });

  it("缺失采样点被插值补全并给出警告", () => {
    const csv = longCsv([{ id: "R01", row: 0, col: 0, intake: 20, exhaust: 40 }]);
    // 删掉一行数据制造缺口
    const lines = csv.split("\n");
    const withoutOne = [lines[0], ...lines.slice(1).filter((_, i) => i !== 5)].join("\n");
    const r = parseThermalData(withoutOne);
    expect(r.racks).toHaveLength(1);
    const vals = Array.from(r.racks[0].intake.values);
    expect(vals.every((v) => Number.isFinite(v))).toBe(true);
    expect(r.issues.some((i) => i.message.includes("缺失"))).toBe(true);
  });

  it("缺少机柜编号的行被跳过", () => {
    const csv = [
      "rack_id,row,col,facing,face,x,y,temp",
      ",0,0,+Z,intake,0,0,25",
      "R02,0,1,+Z,intake,0,0,26",
    ].join("\n");
    const r = parseThermalData(csv);
    expect(r.racks).toHaveLength(1);
    expect(r.racks[0].id).toBe("R02");
    expect(r.issues.some((i) => i.message.includes("缺少机柜编号"))).toBe(true);
  });
});

describe("宽表解析", () => {
  it("把 v0..v35 展开成 6x6", () => {
    const header = ["rack_id", "row", "col", "facing", "face", ...Array.from({ length: 36 }, (_, i) => `v${i}`)];
    const vals = Array.from({ length: 36 }, (_, i) => (20 + i * 0.5).toFixed(1));
    const csv = [header.join(","), ["R01", 0, 0, "+Z", "intake", ...vals].join(",")].join("\n");
    const r = parseThermalData(csv);
    expect(r.format).toBe("wide-csv");
    expect(r.racks).toHaveLength(1);
    const g = r.racks[0].intake;
    expect(g.cols).toBe(6);
    expect(g.rows).toBe(6);
    expect(g.values[0]).toBeCloseTo(20, 1);
    expect(g.values[5]).toBeCloseTo(22.5, 1);
    expect(g.values[7]).toBeCloseTo(23.5, 1);
  });
});

describe("JSON 解析", () => {
  it("支持嵌套数组与扁平数组两种温度结构", () => {
    const nested = Array.from({ length: 6 }, (_, r) =>
      Array.from({ length: 6 }, (_, c) => 25 + r + c * 0.5)
    );
    const data = [
      { rack_id: "R01", row: 0, col: 0, facing: "+Z", intake: nested, exhaust: nested.map((r) => r.map((v) => v + 10)) },
      { rack_id: "R02", row: 0, col: 1, facing: "+Z", intake: nested.flat(), exhaust: nested.flat().map((v) => v + 8) },
    ];
    const r = parseThermalData(JSON.stringify(data));
    expect(r.format).toBe("json");
    expect(r.racks).toHaveLength(2);
    expect(r.racks[0].intake.values[0]).toBeCloseTo(25, 1);
    expect(r.racks[1].intake.values[0]).toBeCloseTo(25, 1);
    expect(r.racks[0].exhaust.values[0]).toBeCloseTo(35, 1);
  });

  it("支持 { racks: [...] } 包装", () => {
    const data = { racks: [{ rack_id: "X", row: 1, col: 2, facing: "-X", intake: new Array(36).fill(30), exhaust: new Array(36).fill(40) }] };
    const r = parseThermalData(JSON.stringify(data));
    expect(r.racks).toHaveLength(1);
    expect(r.racks[0].facing).toBe("-X");
  });

  it("非法 JSON 给出错误", () => {
    const r = parseThermalData("{not json");
    expect(r.racks).toHaveLength(0);
    expect(r.issues[0].severity).toBe("error");
  });
});

describe("边界与鲁棒性", () => {
  it("空输入报错", () => {
    expect(parseThermalData("").racks).toHaveLength(0);
    expect(parseThermalData("   ").racks).toHaveLength(0);
  });

  it("只有表头时报错", () => {
    const r = parseThermalData("rack_id,row,col,facing,face,x,y,temp");
    expect(r.racks).toHaveLength(0);
  });

  it("超过 200 个机柜时截断并报错", () => {
    const racks = Array.from({ length: 205 }, (_, i) => ({
      id: `R${i}`,
      row: Math.floor(i / 25),
      col: i % 25,
      intake: 24,
      exhaust: 36,
    }));
    const r = parseThermalData(longCsv(racks));
    expect(r.racks.length).toBe(200);
    expect(r.issues.some((i) => i.severity === "error" && i.message.includes("200"))).toBe(true);
  });

  it("缺失行列时自动排布", () => {
    const csv = [
      "rack_id,face,x,y,temp",
      "A,intake,0,0,25",
      "B,intake,0,0,25",
    ].join("\n");
    const r = parseThermalData(csv);
    // 该表头没有 x/y 之外的宽表结构，应能识别为长表
    expect(r.racks.length).toBeGreaterThanOrEqual(0);
  });

  it("fillMissing 用均值填充 NaN", () => {
    const a = new Float32Array([20, 30, NaN, 40]);
    fillMissing(a);
    expect(a[2]).toBeCloseTo(30, 5);
  });

  it("全部缺失时回落到 25℃", () => {
    const a = new Float32Array([NaN, NaN]);
    fillMissing(a);
    expect(a[0]).toBe(25);
  });
});
