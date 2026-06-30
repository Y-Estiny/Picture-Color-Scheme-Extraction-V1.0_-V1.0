const SAMPLE_IMAGE = "input/橙蓝调夏日感图纸_1_zzlarki设计日记_来自小红书网页版.jpg";

const imageInput = document.querySelector("#imageInput");
const dropZone = document.querySelector("#dropZone");
const previewFrame = document.querySelector("#previewFrame");
const previewImage = document.querySelector("#previewImage");
const colorCount = document.querySelector("#colorCount");
const colorCountValue = document.querySelector("#colorCountValue");
const palettePanel = document.querySelector(".palette-panel");
const paletteStack = document.querySelector("#paletteStack");
const swatchGrid = document.querySelector("#swatchGrid");
const summaryTotal = document.querySelector("#summaryTotal");
const summaryTop = document.querySelector("#summaryTop");
const downloadButton = document.querySelector("#downloadButton");
const loadSampleButton = document.querySelector("#loadSampleButton");
const exportPanel = document.querySelector("#exportPanel");
const analysisCanvas = document.querySelector("#analysisCanvas");
const ctx = analysisCanvas.getContext("2d", { willReadFrequently: true });
const textEncoder = new TextEncoder();

let activeImageName = "palette";
let currentPalette = [];
let objectUrl = null;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function componentToHex(value) {
  return Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0").toUpperCase();
}

function rgbToHex({ r, g, b }) {
  return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`;
}

function hexWithoutHash(hex) {
  return hex.replace("#", "").toUpperCase();
}

function sanitizeFilename(name) {
  return (name || "palette")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "palette";
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function colorName(color, index) {
  return `Color ${String(index + 1).padStart(2, "0")} ${color.hex}`;
}

function paletteRows(palette = currentPalette) {
  return palette.map((color, index) => ({
    rank: index + 1,
    name: colorName(color, index),
    hex: color.hex,
    r: Math.round(color.r),
    g: Math.round(color.g),
    b: Math.round(color.b),
    ratio: Number(color.ratio.toFixed(4)),
    percent: Number((color.ratio * 100).toFixed(1)),
  }));
}

function rgbToLab({ r, g, b }) {
  let x;
  let y;
  let z;
  r /= 255;
  g /= 255;
  b /= 255;

  r = r > 0.04045 ? ((r + 0.055) / 1.055) ** 2.4 : r / 12.92;
  g = g > 0.04045 ? ((g + 0.055) / 1.055) ** 2.4 : g / 12.92;
  b = b > 0.04045 ? ((b + 0.055) / 1.055) ** 2.4 : b / 12.92;

  x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1;
  z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;

  x = x > 0.008856 ? x ** (1 / 3) : 7.787 * x + 16 / 116;
  y = y > 0.008856 ? y ** (1 / 3) : 7.787 * y + 16 / 116;
  z = z > 0.008856 ? z ** (1 / 3) : 7.787 * z + 16 / 116;

  return {
    l: 116 * y - 16,
    a: 500 * (x - y),
    b: 200 * (y - z),
  };
}

function labDistance(a, b) {
  return (a.l - b.l) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2;
}

function buildWeightedColorBins(imageData) {
  const bins = new Map();
  const data = imageData.data;

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha < 24) continue;

    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const key = `${r >> 4},${g >> 4},${b >> 4}`;
    const existing = bins.get(key);

    if (existing) {
      existing.r += r;
      existing.g += g;
      existing.b += b;
      existing.count += 1;
    } else {
      bins.set(key, { r, g, b, count: 1 });
    }
  }

  return [...bins.values()]
    .map((bin) => {
      const color = {
        r: bin.r / bin.count,
        g: bin.g / bin.count,
        b: bin.b / bin.count,
      };
      return {
        ...color,
        lab: rgbToLab(color),
        count: bin.count,
      };
    })
    .sort((a, b) => b.count - a.count);
}

function seedCentroids(points, targetCount) {
  const centroids = [];
  for (const point of points) {
    const farEnough = centroids.every((centroid) => labDistance(point.lab, centroid.lab) > 250);
    if (farEnough) {
      centroids.push({ r: point.r, g: point.g, b: point.b, lab: point.lab });
    }
    if (centroids.length === targetCount) break;
  }

  for (const point of points) {
    if (centroids.length === targetCount) break;
    centroids.push({ r: point.r, g: point.g, b: point.b, lab: point.lab });
  }

  return centroids;
}

function clusterColors(points, targetCount) {
  if (!points.length) return [];

  const k = Math.min(targetCount, points.length);
  let centroids = seedCentroids(points, k);
  let groups = [];

  for (let iteration = 0; iteration < 14; iteration += 1) {
    groups = centroids.map(() => ({ r: 0, g: 0, b: 0, count: 0, points: [] }));

    for (const point of points) {
      let bestIndex = 0;
      let bestDistance = Infinity;
      for (let i = 0; i < centroids.length; i += 1) {
        const distance = labDistance(point.lab, centroids[i].lab);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = i;
        }
      }

      const group = groups[bestIndex];
      group.r += point.r * point.count;
      group.g += point.g * point.count;
      group.b += point.b * point.count;
      group.count += point.count;
      group.points.push(point);
    }

    centroids = groups.map((group, index) => {
      if (!group.count) return centroids[index];
      const color = {
        r: group.r / group.count,
        g: group.g / group.count,
        b: group.b / group.count,
      };
      return { ...color, lab: rgbToLab(color) };
    });
  }

  const total = groups.reduce((sum, group) => sum + group.count, 0);
  return groups
    .filter((group) => group.count > 0)
    .map((group) => {
      const color = {
        r: group.r / group.count,
        g: group.g / group.count,
        b: group.b / group.count,
      };
      return {
        ...color,
        hex: rgbToHex(color),
        ratio: group.count / total,
      };
    })
    .sort((a, b) => b.ratio - a.ratio);
}

function analyzeActiveImage() {
  if (!previewImage.complete || !previewImage.naturalWidth) return;

  const maxSide = 620;
  const ratio = Math.min(1, maxSide / Math.max(previewImage.naturalWidth, previewImage.naturalHeight));
  analysisCanvas.width = Math.max(1, Math.round(previewImage.naturalWidth * ratio));
  analysisCanvas.height = Math.max(1, Math.round(previewImage.naturalHeight * ratio));
  ctx.clearRect(0, 0, analysisCanvas.width, analysisCanvas.height);
  ctx.drawImage(previewImage, 0, 0, analysisCanvas.width, analysisCanvas.height);

  const imageData = ctx.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height);
  const bins = buildWeightedColorBins(imageData);
  currentPalette = clusterColors(bins, Number(colorCount.value));
  renderPalette(currentPalette);
}

function buildPaletteRecord(palette = currentPalette) {
  return JSON.stringify(
    {
      type: "image_palette",
      source: activeImageName,
      color_count: palette.length,
      dominant_hex: palette[0]?.hex || null,
      colors: palette.map((color, index) => ({
        rank: index + 1,
        hex: color.hex,
        rgb: {
          r: Math.round(color.r),
          g: Math.round(color.g),
          b: Math.round(color.b),
        },
        ratio: Number(color.ratio.toFixed(4)),
        percent: Number((color.ratio * 100).toFixed(1)),
      })),
    },
    null,
    2,
  );
}

function renderPalette(palette) {
  palettePanel.classList.toggle("has-colors", palette.length > 0);
  downloadButton.disabled = palette.length === 0;
  summaryTotal.textContent = String(palette.length);
  summaryTop.textContent = palette[0] ? `${Math.round(palette[0].ratio * 100)}%` : "--";
  exportPanel.hidden = palette.length === 0;

  paletteStack.innerHTML = "";
  swatchGrid.innerHTML = "";

  for (const color of palette) {
    const segment = document.createElement("div");
    segment.className = "stack-segment";
    segment.style.background = color.hex;
    segment.style.width = `${Math.max(color.ratio * 100, 2)}%`;
    segment.title = `${color.hex} · ${(color.ratio * 100).toFixed(1)}%`;
    paletteStack.append(segment);

    const card = document.createElement("article");
    card.className = "swatch-card";
    card.innerHTML = `
      <div class="swatch-color" style="background:${color.hex}"></div>
      <div class="swatch-body">
        <div>
          <p class="hex-code">${color.hex}</p>
          <p class="rgb-code">RGB ${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}</p>
        </div>
        <span class="ratio-badge">${(color.ratio * 100).toFixed(1)}%</span>
        <button class="copy-button" type="button" data-hex="${color.hex}">复制 HEX</button>
      </div>
    `;
    swatchGrid.append(card);
  }
}

function loadImage(src, name = "palette") {
  activeImageName = name.replace(/\.[^.]+$/, "") || "palette";
  previewImage.onload = () => {
    previewFrame.classList.add("has-image");
    analyzeActiveImage();
  };
  previewImage.onerror = () => {
    previewFrame.classList.remove("has-image");
    renderPalette([]);
  };
  previewImage.src = src;
}

function loadFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  loadImage(objectUrl, file.name);
}

function triggerDownload(filename, href) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = href;
  document.body.append(link);
  link.click();
  link.remove();
}

function scheduleRevoke(url) {
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 3000);
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png", 1);
  });
}

function drawContainedImage(context, image, x, y, width, height) {
  const imageRatio = image.naturalWidth / image.naturalHeight;
  const frameRatio = width / height;
  let drawWidth = width;
  let drawHeight = height;
  let drawX = x;
  let drawY = y;

  if (imageRatio > frameRatio) {
    drawHeight = width / imageRatio;
    drawY = y + (height - drawHeight) / 2;
  } else {
    drawWidth = height * imageRatio;
    drawX = x + (width - drawWidth) / 2;
  }

  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
}

function makeTextBlob(text, type) {
  return new Blob([text], { type: `${type};charset=utf-8` });
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  triggerDownload(filename, url);
  scheduleRevoke(url);
}

function buildCsvText() {
  const header = ["rank", "name", "hex", "r", "g", "b", "ratio", "percent"];
  const rows = paletteRows().map((row) =>
    [row.rank, row.name, row.hex, row.r, row.g, row.b, row.ratio, row.percent]
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
      .join(","),
  );
  return `\uFEFF${header.join(",")}\n${rows.join("\n")}\n`;
}

function buildCssText() {
  const lines = [
    `/* Palette from ${activeImageName} */`,
    ":root {",
  ];

  for (const row of paletteRows()) {
    lines.push(`  --palette-color-${row.rank}: ${row.hex};`);
    lines.push(`  --palette-color-${row.rank}-rgb: ${row.r}, ${row.g}, ${row.b};`);
    lines.push(`  --palette-color-${row.rank}-ratio: ${row.ratio};`);
  }

  lines.push("}");
  return `${lines.join("\n")}\n`;
}

function buildScssText() {
  const rows = paletteRows();
  const lines = [`// Palette from ${activeImageName}`];

  for (const row of rows) {
    lines.push(`$palette-color-${row.rank}: ${row.hex};`);
    lines.push(`$palette-color-${row.rank}-ratio: ${row.ratio};`);
  }

  lines.push("");
  lines.push("$palette-colors: (");
  for (const row of rows) {
    lines.push(`  "${row.rank}": (color: ${row.hex}, ratio: ${row.ratio}, percent: ${row.percent}),`);
  }
  lines.push(");");

  return `${lines.join("\n")}\n`;
}

function buildQgisStyleXml() {
  const rows = paletteRows();
  const name = escapeXml(activeImageName);
  const stops = rows
    .map((row, index) => {
      const stop = rows.length <= 1 ? 0 : index / (rows.length - 1);
      return `${stop.toFixed(6)};${row.r},${row.g},${row.b},255`;
    })
    .join(":");

  return `<!DOCTYPE qgis_style>
<qgis_style version="2">
  <symbols/>
  <colorramps>
    <colorramp type="preset" name="${name} palette">
${rows.map((row, index) => `      <prop k="preset_color_${index}" v="${row.r},${row.g},${row.b},255"/>`).join("\n")}
    </colorramp>
    <colorramp type="gradient" name="${name} weighted ramp">
      <prop k="color1" v="${rows[0].r},${rows[0].g},${rows[0].b},255"/>
      <prop k="color2" v="${rows.at(-1).r},${rows.at(-1).g},${rows.at(-1).b},255"/>
      <prop k="discrete" v="0"/>
      <prop k="stops" v="${stops}"/>
    </colorramp>
  </colorramps>
  <colors>
${rows.map((row) => `    <color name="${escapeXml(row.name)}" color="${row.hex}" alpha="255"/>`).join("\n")}
  </colors>
</qgis_style>
`;
}

function buildArcGisStylxManifest() {
  const rows = paletteRows();
  return JSON.stringify(
    {
      type: "arcgis_pro_palette_transfer",
      format_note:
        "ArcGIS Pro .stylx is a native style database. This browser export stores palette colors and CIM RGB values for recreating a Pro style.",
      source: activeImageName,
      color_count: rows.length,
      colors: rows.map((row) => ({
        name: row.name,
        hex: row.hex,
        rgb: [row.r, row.g, row.b],
        cim_color: {
          type: "CIMRGBColor",
          values: [row.r, row.g, row.b, 100],
        },
        ratio: row.ratio,
        percent: row.percent,
      })),
    },
    null,
    2,
  );
}

function buildAseBlob() {
  const rows = paletteRows();
  const blocks = rows.map((row) => {
    const name = row.name;
    const nameLength = name.length + 1;
    const blockLength = 2 + nameLength * 2 + 4 + 12 + 2;
    return { row, name, nameLength, blockLength };
  });
  const totalLength = 12 + blocks.reduce((sum, block) => sum + 6 + block.blockLength, 0);
  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);
  let offset = 0;

  function writeAscii(value) {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset, value.charCodeAt(i));
      offset += 1;
    }
  }

  function writeUtf16Be(value) {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint16(offset, value.charCodeAt(i), false);
      offset += 2;
    }
    view.setUint16(offset, 0, false);
    offset += 2;
  }

  writeAscii("ASEF");
  view.setUint16(offset, 1, false);
  offset += 2;
  view.setUint16(offset, 0, false);
  offset += 2;
  view.setUint32(offset, blocks.length, false);
  offset += 4;

  for (const block of blocks) {
    view.setUint16(offset, 0x0001, false);
    offset += 2;
    view.setUint32(offset, block.blockLength, false);
    offset += 4;
    view.setUint16(offset, block.nameLength, false);
    offset += 2;
    writeUtf16Be(block.name);
    writeAscii("RGB ");
    view.setFloat32(offset, block.row.r / 255, false);
    offset += 4;
    view.setFloat32(offset, block.row.g / 255, false);
    offset += 4;
    view.setFloat32(offset, block.row.b / 255, false);
    offset += 4;
    view.setUint16(offset, 0, false);
    offset += 2;
  }

  return new Blob([buffer], { type: "application/octet-stream" });
}

function crc32(bytes) {
  if (!crc32.table) {
    crc32.table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let value = i;
      for (let j = 0; j < 8; j += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crc32.table[i] = value >>> 0;
    }
  }

  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crc32.table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(parts) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function zipDateParts(date = new Date()) {
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = Math.max(1980, date.getFullYear()) - 1980;
  return {
    time,
    date: (year << 9) | (month << 5) | day,
  };
}

function makeZipBlob(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const { time, date } = zipDateParts();

  for (const file of files) {
    const nameBytes = textEncoder.encode(file.name);
    const dataBytes = typeof file.data === "string" ? textEncoder.encode(file.data) : file.data;
    const checksum = crc32(dataBytes);

    const local = new Uint8Array(30 + nameBytes.length + dataBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, dataBytes.length, true);
    localView.setUint32(22, dataBytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(dataBytes, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, date, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, dataBytes.length, true);
    centralView.setUint32(24, dataBytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);
    offset += local.length;
  }

  const centralDirectory = concatBytes(centrals);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralDirectory.length, true);
  endView.setUint32(16, offset, true);

  return new Blob([concatBytes([...locals, centralDirectory, end])], { type: "application/zip" });
}

function buildOfficeThemeXml() {
  const rows = paletteRows();
  const getColor = (index, fallback) => hexWithoutHash(rows[index % rows.length]?.hex || fallback);
  const accents = Array.from({ length: 6 }, (_, index) => getColor(index, "4F81BD"));

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${escapeXml(activeImageName)} Palette">
  <a:themeElements>
    <a:clrScheme name="${escapeXml(activeImageName)}">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="${getColor(0, "1F497D")}"/></a:dk2>
      <a:lt2><a:srgbClr val="F8FAF9"/></a:lt2>
      <a:accent1><a:srgbClr val="${accents[0]}"/></a:accent1>
      <a:accent2><a:srgbClr val="${accents[1]}"/></a:accent2>
      <a:accent3><a:srgbClr val="${accents[2]}"/></a:accent3>
      <a:accent4><a:srgbClr val="${accents[3]}"/></a:accent4>
      <a:accent5><a:srgbClr val="${accents[4]}"/></a:accent5>
      <a:accent6><a:srgbClr val="${accents[5]}"/></a:accent6>
      <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
      <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>
        <a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="50000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
      </a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/></a:schemeClr></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"><a:shade val="95000"/></a:schemeClr></a:solidFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
  <a:objectDefaults/>
  <a:extraClrSchemeLst/>
</a:theme>
`;
}

function buildOfficeThemeBlob() {
  return makeZipBlob([
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/theme/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
</Types>
`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme/theme1.xml"/>
</Relationships>
`,
    },
    {
      name: "theme/theme/theme1.xml",
      data: buildOfficeThemeXml(),
    },
  ]);
}

async function exportFile(format) {
  const base = sanitizeFilename(activeImageName);
  const files = {
    ase: () => ({
      filename: `${base}-adobe-swatches.ase`,
      blob: buildAseBlob(),
    }),
    stylx: () => ({
      filename: `${base}-arcgis-pro.stylx`,
      blob: makeTextBlob(buildArcGisStylxManifest(), "application/json"),
    }),
    qgis: () => ({
      filename: `${base}-qgis_style.xml`,
      blob: makeTextBlob(buildQgisStyleXml(), "application/xml"),
    }),
    thmx: () => ({
      filename: `${base}-office_theme.thmx`,
      blob: buildOfficeThemeBlob(),
    }),
    json: () => ({
      filename: `${base}-palette.json`,
      blob: makeTextBlob(`${buildPaletteRecord()}\n`, "application/json"),
    }),
    css: () => ({
      filename: `${base}-palette.css`,
      blob: makeTextBlob(buildCssText(), "text/css"),
    }),
    scss: () => ({
      filename: `${base}-palette.scss`,
      blob: makeTextBlob(buildScssText(), "text/x-scss"),
    }),
    csv: () => ({
      filename: `${base}-palette.csv`,
      blob: makeTextBlob(buildCsvText(), "text/csv"),
    }),
  };

  if (format === "all") {
    const bundledFormats = ["ase", "stylx", "qgis", "thmx", "json", "css", "scss", "csv"];
    const zipFiles = [];
    for (const bundledFormat of bundledFormats) {
      const file = await exportFile(bundledFormat);
      zipFiles.push({
        name: file.filename,
        data: new Uint8Array(await file.blob.arrayBuffer()),
      });
    }
    return {
      filename: `${base}-palette-exports.zip`,
      blob: makeZipBlob(zipFiles),
    };
  }

  return files[format]();
}

async function downloadExport(format) {
  if (!currentPalette.length) return;
  const file = await exportFile(format);
  downloadBlob(file.filename, file.blob);
}

async function savePaletteAssets() {
  if (!currentPalette.length) return;

  const scale = 2;
  const width = 1500;
  const margin = 64;
  const gap = 54;
  const leftWidth = 630;
  const rightX = margin + leftWidth + gap;
  const rightWidth = width - margin - rightX;
  const stackY = 112;
  const stackHeight = 72;
  const rowHeight = 118;
  const rowsTop = 224;
  const height = Math.max(920, rowsTop + currentPalette.length * rowHeight + 64);
  const canvas = document.createElement("canvas");
  const cardCtx = canvas.getContext("2d");
  canvas.width = width * scale;
  canvas.height = height * scale;
  cardCtx.scale(scale, scale);

  cardCtx.fillStyle = "#FFFFFF";
  cardCtx.fillRect(0, 0, width, height);

  cardCtx.strokeStyle = "#E2E7EA";
  cardCtx.lineWidth = 2;
  cardCtx.strokeRect(margin, 112, leftWidth, height - 176);
  cardCtx.fillStyle = "#F8FAF9";
  cardCtx.fillRect(margin + 1, 113, leftWidth - 2, height - 178);
  drawContainedImage(cardCtx, previewImage, margin + 22, 134, leftWidth - 44, height - 220);

  cardCtx.fillStyle = "#182027";
  cardCtx.font = "800 42px system-ui, sans-serif";
  cardCtx.fillText("原图", margin, 82);
  cardCtx.font = "800 46px system-ui, sans-serif";
  cardCtx.fillText("图片主色提取色卡", rightX, 82);

  let x = rightX;
  const stackW = rightWidth;
  for (const color of currentPalette) {
    const segmentW = stackW * color.ratio;
    cardCtx.fillStyle = color.hex;
    cardCtx.fillRect(x, stackY, segmentW, stackHeight);
    x += segmentW;
  }

  cardCtx.strokeStyle = "#DDE3E7";
  cardCtx.lineWidth = 2;
  cardCtx.strokeRect(rightX, stackY, stackW, stackHeight);
  cardCtx.fillStyle = "#66717D";
  cardCtx.font = "700 19px system-ui, sans-serif";
  cardCtx.fillText(`${currentPalette.length} 个主色 · 最高占比 ${Math.round(currentPalette[0].ratio * 100)}%`, rightX, stackY + stackHeight + 34);

  currentPalette.forEach((color, index) => {
    const y = rowsTop + index * rowHeight;
    const swatchWidth = Math.floor(rightWidth * 0.5);
    const swatchHeight = 88;
    const textX = rightX + swatchWidth + 28;

    cardCtx.strokeStyle = "#E2E7EA";
    cardCtx.lineWidth = 2;
    cardCtx.strokeRect(rightX, y, rightWidth, swatchHeight);
    cardCtx.fillStyle = color.hex;
    cardCtx.fillRect(rightX, y, swatchWidth, swatchHeight);

    cardCtx.fillStyle = "#182027";
    cardCtx.font = "800 34px system-ui, sans-serif";
    cardCtx.fillText(color.hex, textX, y + 36);
    cardCtx.fillStyle = "#66717D";
    cardCtx.font = "600 20px system-ui, sans-serif";
    cardCtx.fillText(`RGB ${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}`, textX, y + 70);
    cardCtx.fillStyle = "#182027";
    cardCtx.font = "800 28px system-ui, sans-serif";
    cardCtx.textAlign = "right";
    cardCtx.fillText(`${(color.ratio * 100).toFixed(1)}%`, rightX + rightWidth - 22, y + 54);
    cardCtx.textAlign = "left";
  });

  const imageBlob = await canvasToBlob(canvas);
  if (imageBlob) {
    const imageUrl = URL.createObjectURL(imageBlob);
    triggerDownload(`${activeImageName}-palette-card.png`, imageUrl);
    scheduleRevoke(imageUrl);
  }

  downloadButton.textContent = "已保存";
  window.setTimeout(() => {
    downloadButton.textContent = "保存配色";
  }, 1400);
}

imageInput.addEventListener("change", (event) => {
  loadFile(event.target.files[0]);
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("is-dragging");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("is-dragging");
});

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-dragging");
  loadFile(event.dataTransfer.files[0]);
});

colorCount.addEventListener("input", () => {
  colorCountValue.textContent = `${colorCount.value} 色`;
  analyzeActiveImage();
});

swatchGrid.addEventListener("click", async (event) => {
  const button = event.target.closest(".copy-button");
  if (!button) return;
  const hex = button.dataset.hex;
  try {
    await navigator.clipboard.writeText(hex);
    button.textContent = "已复制";
    window.setTimeout(() => {
      button.textContent = "复制 HEX";
    }, 1200);
  } catch {
    button.textContent = hex;
  }
});

exportPanel.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-export]");
  if (!button) return;

  const format = button.dataset.export;
  button.disabled = true;
  try {
    await downloadExport(format);
  } finally {
    window.setTimeout(() => {
      button.disabled = false;
    }, 600);
  }
});

downloadButton.addEventListener("click", savePaletteAssets);

loadSampleButton.addEventListener("click", () => {
  loadImage(SAMPLE_IMAGE, "示例图片");
});

loadImage(SAMPLE_IMAGE, "示例图片");
