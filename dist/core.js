import { Vector3, BufferGeometry, BufferAttribute } from 'three';
import JSZip from 'jszip';

// src/core/parser.ts
function calculateVolume(geometry) {
  const position = geometry.attributes.position;
  if (!position) throw new Error("Geometry has no position attribute");
  let volume = 0;
  const index = geometry.index;
  if (index) {
    const arr = index.array;
    for (let i = 0; i < index.count; i += 3) {
      volume += signedVolumeOfTriangle(
        new Vector3(position.getX(arr[i]), position.getY(arr[i]), position.getZ(arr[i])),
        new Vector3(position.getX(arr[i + 1]), position.getY(arr[i + 1]), position.getZ(arr[i + 1])),
        new Vector3(position.getX(arr[i + 2]), position.getY(arr[i + 2]), position.getZ(arr[i + 2]))
      );
    }
  } else {
    for (let i = 0; i < position.count; i += 3) {
      volume += signedVolumeOfTriangle(
        new Vector3(position.getX(i), position.getY(i), position.getZ(i)),
        new Vector3(position.getX(i + 1), position.getY(i + 1), position.getZ(i + 1)),
        new Vector3(position.getX(i + 2), position.getY(i + 2), position.getZ(i + 2))
      );
    }
  }
  return Math.abs(volume) / 1e3;
}
function signedVolumeOfTriangle(p1, p2, p3) {
  return p1.dot(p2.cross(p3)) / 6;
}
function calculateBoundingBox(geometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) throw new Error("Failed to compute bounding box");
  const size = new Vector3();
  box.getSize(size);
  return {
    x: Number(size.x.toFixed(2)),
    y: Number(size.y.toFixed(2)),
    z: Number(size.z.toFixed(2))
  };
}
var ThreeMFParseError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ThreeMFParseError";
  }
};
function findElements(container, localName) {
  const found = /* @__PURE__ */ new Set();
  const lowerName = localName.toLowerCase();
  try {
    container.querySelectorAll(localName).forEach((el) => found.add(el));
  } catch {
  }
  const allElements = container.getElementsByTagName("*");
  for (let i = 0; i < allElements.length; i++) {
    const elem = allElements[i];
    const elemLocal = (elem.localName || "").toLowerCase();
    const tagLower = elem.tagName.toLowerCase();
    if (elemLocal === lowerName || tagLower === lowerName || tagLower.endsWith(":" + lowerName)) {
      found.add(elem);
    }
  }
  return Array.from(found);
}
function normalizeColor(color) {
  if (!color || color.trim() === "") return "#808080";
  let c = color.trim();
  if (!c.startsWith("#")) c = "#" + c;
  if (c.length === 9) c = c.substring(0, 7);
  return c.toUpperCase();
}
function parseResources(xmlDoc) {
  const resources = /* @__PURE__ */ new Map();
  for (const bmElem of findElements(xmlDoc, "basematerials")) {
    const id = bmElem.getAttribute("id") || bmElem.getAttribute("Id") || "";
    if (!id) continue;
    const colors = [];
    const names = [];
    for (const base of findElements(bmElem, "base")) {
      colors.push(normalizeColor(base.getAttribute("displaycolor") || base.getAttribute("DisplayColor") || ""));
      names.push(base.getAttribute("name") || base.getAttribute("Name") || "");
    }
    if (colors.length > 0) resources.set(id, { id, type: "basematerials", colors, names });
  }
  for (const cgElem of findElements(xmlDoc, "colorgroup")) {
    const id = cgElem.getAttribute("id") || cgElem.getAttribute("Id") || "";
    if (!id) continue;
    const colors = [];
    for (const colorElem of findElements(cgElem, "color")) {
      const c = colorElem.getAttribute("color") || colorElem.getAttribute("Color") || "";
      if (c) colors.push(normalizeColor(c));
    }
    if (colors.length > 0) resources.set(id, { id, type: "colorgroup", colors });
  }
  return resources;
}
function resolveColor(pid, pindex, resources) {
  if (!pid) return null;
  const resource = resources.get(pid);
  if (!resource) return null;
  if (pindex < 0 || pindex >= resource.colors.length) return null;
  return resource.colors[pindex];
}
function parseGeometryObjects(xmlDoc, resources, defaultColor) {
  const objects = [];
  for (const objElem of findElements(xmlDoc, "object")) {
    const type = objElem.getAttribute("type");
    if (type && type !== "model") continue;
    const id = parseInt(objElem.getAttribute("id") || "0");
    const name = objElem.getAttribute("name") || objElem.getAttribute("Name") || `Object ${id}`;
    const objPid = objElem.getAttribute("pid") || null;
    const objPindexStr = objElem.getAttribute("pindex");
    const objPindex = objPindexStr !== null ? parseInt(objPindexStr) : 0;
    const objDefaultColor = resolveColor(objPid, objPindex, resources) || defaultColor || null;
    const meshElems = findElements(objElem, "mesh");
    if (meshElems.length === 0) continue;
    const meshElem = meshElems[0];
    const vertices = [];
    for (const v of findElements(meshElem, "vertex")) {
      vertices.push(
        parseFloat(v.getAttribute("x") || "0"),
        parseFloat(v.getAttribute("y") || "0"),
        parseFloat(v.getAttribute("z") || "0")
      );
    }
    if (vertices.length === 0) continue;
    const triangles = [];
    for (const t of findElements(meshElem, "triangle")) {
      const v1 = parseInt(t.getAttribute("v1") || "0");
      const v2 = parseInt(t.getAttribute("v2") || "0");
      const v3 = parseInt(t.getAttribute("v3") || "0");
      const triPid = t.getAttribute("pid") || null;
      const p1Str = t.getAttribute("p1");
      let colorHex = null;
      if (triPid && p1Str !== null) {
        colorHex = resolveColor(triPid, parseInt(p1Str), resources);
      } else if (triPid) {
        colorHex = resolveColor(triPid, 0, resources);
      }
      if (!colorHex && objDefaultColor) colorHex = objDefaultColor;
      let paintAttr = t.getAttribute("paint_color") || t.getAttribute("slic3rpe:mmu_segmentation") || t.getAttribute("mmu_segmentation") || null;
      if (!paintAttr) {
        for (let ai = 0; ai < t.attributes.length; ai++) {
          const aName = t.attributes[ai].name.toLowerCase();
          if (aName.includes("paint_color") || aName.includes("mmu_segmentation")) {
            paintAttr = t.attributes[ai].value;
            break;
          }
        }
      }
      triangles.push({ v1, v2, v3, colorHex, paintAttr: paintAttr || void 0 });
    }
    if (vertices.length > 0 && triangles.length > 0) {
      objects.push({ id, name, vertices, triangles });
    }
  }
  return objects;
}
function parseComponents(objElem) {
  const components = [];
  const seen = /* @__PURE__ */ new Set();
  const compElems = [
    ...Array.from(objElem.querySelectorAll("components > component")),
    ...findElements(objElem, "component")
  ];
  for (const comp of compElems) {
    if (seen.has(comp)) continue;
    seen.add(comp);
    const objectId = parseInt(comp.getAttribute("objectid") || "0");
    if (objectId <= 0) continue;
    let path;
    for (let i = 0; i < comp.attributes.length; i++) {
      const attr = comp.attributes[i];
      if (attr.localName === "path" || attr.name.endsWith(":path")) {
        path = attr.value;
        break;
      }
    }
    const pid = comp.getAttribute("pid") || void 0;
    const pindex = pid ? parseInt(comp.getAttribute("pindex") || "0") : void 0;
    components.push({ objectId, path, pid, pindex });
  }
  return components;
}
async function extractFilamentColors(zipContent) {
  let filamentCount = 0;
  for (const path of ["Metadata/project_settings.config", "Metadata/Project_settings.config"]) {
    const file = zipContent.file(path);
    if (!file) continue;
    try {
      const content = await file.async("text");
      const trimmed = content.trim();
      if (trimmed.startsWith("{")) {
        try {
          const json = JSON.parse(trimmed);
          for (const key of Object.keys(json)) {
            if (Array.isArray(json[key]) && json[key].length > 1) {
              filamentCount = Math.max(filamentCount, json[key].length);
            }
          }
          const colorKey = Object.keys(json).find(
            (k) => k.toLowerCase() === "filament_colour" || k.toLowerCase() === "filament_color"
          );
          if (colorKey) {
            let rawColors = [];
            const val = json[colorKey];
            if (Array.isArray(val)) {
              rawColors = val.map((c) => String(c).trim()).filter((c) => c.length > 0);
            } else if (typeof val === "string") {
              rawColors = val.split(";").map((c) => c.trim()).filter((c) => c.length > 0);
            }
            const colors = rawColors.map((c) => normalizeColor(c));
            if (colors.length > 0)
              return { colors, filamentCount: Math.max(filamentCount, colors.length) };
          }
          if (filamentCount > 1) return { colors: [], filamentCount };
        } catch {
        }
      }
      const match = content.match(/filament_colou?r\s*=\s*(.+)/i);
      if (match) {
        const raw = match[1].split(";").map((c) => c.trim()).filter((c) => c.length > 0);
        const colors = raw.map((c) => normalizeColor(c));
        if (colors.length > 0) return { colors, filamentCount: Math.max(filamentCount, colors.length) };
      }
    } catch {
    }
  }
  const sliceInfoFile = zipContent.file("Metadata/slice_info.config");
  if (sliceInfoFile) {
    try {
      const content = await sliceInfoFile.async("text");
      const parser = new DOMParser();
      const doc = parser.parseFromString(content, "text/xml");
      const colors = [];
      for (const f of findElements(doc, "filament")) {
        const c = f.getAttribute("color") || f.getAttribute("Color") || "";
        if (c && c.trim()) colors.push(normalizeColor(c));
      }
      const unique = [...new Set(colors)];
      if (unique.length > 0) return { colors: unique, filamentCount: Math.max(filamentCount, unique.length) };
    } catch {
    }
  }
  const configFiles = Object.keys(zipContent.files).filter(
    (f) => f.endsWith(".config") && !f.includes("model_settings")
  );
  for (const path of configFiles) {
    try {
      const content = await zipContent.file(path)?.async("text");
      if (!content) continue;
      const trimmed = content.trim();
      if (trimmed.startsWith("{")) {
        try {
          const json = JSON.parse(trimmed);
          const colorKey = Object.keys(json).find(
            (k) => k.toLowerCase() === "filament_colour" || k.toLowerCase() === "filament_color"
          );
          if (colorKey) {
            let rawColors = [];
            const val = json[colorKey];
            if (Array.isArray(val)) {
              rawColors = val.map((c) => String(c).trim()).filter((c) => c.length > 0);
            } else if (typeof val === "string") {
              rawColors = val.split(";").map((c) => c.trim()).filter((c) => c.length > 0);
            }
            const colors = rawColors.map((c) => normalizeColor(c));
            if (colors.length > 0) return { colors, filamentCount: Math.max(filamentCount, colors.length) };
          }
        } catch {
        }
      }
      const match = content.match(/filament_colou?r\s*=\s*(.+)/i);
      if (match) {
        const raw = match[1].split(";").map((c) => c.trim()).filter((c) => c.length > 0);
        const colors = raw.map((c) => normalizeColor(c));
        if (colors.length > 0) return { colors, filamentCount: Math.max(filamentCount, colors.length) };
      }
    } catch {
    }
  }
  return { colors: [], filamentCount };
}
async function parseModelSettings(zipContent) {
  const objectExtruderMap = /* @__PURE__ */ new Map();
  let hasMmuSegmentation = false;
  const distinctExtruders = /* @__PURE__ */ new Set();
  const modelSettingsFile = zipContent.file("Metadata/model_settings.config");
  if (!modelSettingsFile) return { objectExtruderMap, hasMmuSegmentation, distinctExtruders };
  try {
    const content = await modelSettingsFile.async("text");
    const parser = new DOMParser();
    const configDoc = parser.parseFromString(content, "text/xml");
    const configObjects = findElements(configDoc, "object");
    for (const obj of configObjects) {
      const objId = parseInt(obj.getAttribute("id") || "0");
      if (objId <= 0) continue;
      const allObjMeta = /* @__PURE__ */ new Map();
      const partMeta = /* @__PURE__ */ new Set();
      const parts = findElements(obj, "part");
      for (const part of parts) {
        for (const meta of findElements(part, "metadata")) {
          partMeta.add(meta);
          const key = meta.getAttribute("key") || "";
          const value = meta.getAttribute("value") || meta.textContent?.trim() || "";
          if (key === "mmu_segmentation" && value.length > 0) hasMmuSegmentation = true;
        }
      }
      for (const meta of findElements(obj, "metadata")) {
        if (partMeta.has(meta)) continue;
        const key = meta.getAttribute("key") || "";
        const value = meta.getAttribute("value") || meta.textContent?.trim() || "";
        allObjMeta.set(key, value);
        if (key === "mmu_segmentation" && value.length > 0) hasMmuSegmentation = true;
      }
      for (const part of parts) {
        const subObjId = parseInt(part.getAttribute("sub_object_id") || "0");
        const partIdAttr = parseInt(part.getAttribute("id") || "0");
        const targetId = subObjId || partIdAttr;
        const partMetaMap = /* @__PURE__ */ new Map();
        for (const meta of findElements(part, "metadata")) {
          const key = meta.getAttribute("key") || "";
          const value = meta.getAttribute("value") || meta.textContent?.trim() || "";
          partMetaMap.set(key, value);
        }
        for (const childTag of ["paint_color", "mmu_segmentation"]) {
          if (findElements(part, childTag).length > 0) hasMmuSegmentation = true;
        }
        if (targetId <= 0) continue;
        const extruderStr = partMetaMap.get("extruder");
        if (extruderStr !== void 0) {
          const extruder = parseInt(extruderStr);
          if (!isNaN(extruder) && extruder >= 0) {
            const effectiveExtruder = extruder === 0 ? 1 : extruder;
            objectExtruderMap.set(targetId, effectiveExtruder);
            distinctExtruders.add(effectiveExtruder);
          }
        }
      }
      const objExtruderStr = allObjMeta.get("extruder");
      if (objExtruderStr !== void 0) {
        const objExtruder = parseInt(objExtruderStr);
        if (!isNaN(objExtruder) && objExtruder >= 0) {
          const effectiveExtruder = objExtruder === 0 ? 1 : objExtruder;
          if (!objectExtruderMap.has(objId)) {
            objectExtruderMap.set(objId, effectiveExtruder);
            distinctExtruders.add(effectiveExtruder);
          }
          for (const part of parts) {
            const subObjId = parseInt(part.getAttribute("sub_object_id") || "0");
            const partIdAttr = parseInt(part.getAttribute("id") || "0");
            const targetId = subObjId || partIdAttr;
            if (targetId > 0 && !objectExtruderMap.has(targetId)) {
              objectExtruderMap.set(targetId, effectiveExtruder);
              distinctExtruders.add(effectiveExtruder);
            }
          }
        }
      }
    }
    return { objectExtruderMap, hasMmuSegmentation, distinctExtruders };
  } catch {
    return { objectExtruderMap, hasMmuSegmentation, distinctExtruders };
  }
}
async function parseBambuPlates(zipContent) {
  const plates = [];
  const plateObjectMap = /* @__PURE__ */ new Map();
  const plateFiles = Object.keys(zipContent.files).filter((f) => /Metadata\/plate_\d+\.json/i.test(f)).sort();
  if (plateFiles.length > 0) {
    for (const platePath of plateFiles) {
      try {
        const content = await zipContent.file(platePath)?.async("text");
        if (!content) continue;
        const plateData = JSON.parse(content);
        const plateNum = parseInt(platePath.match(/plate_(\d+)/)?.[1] || "0");
        if (plateNum <= 0) continue;
        const objectIds = [];
        if (Array.isArray(plateData)) {
          plateData.forEach((item) => {
            if (item.id !== void 0) objectIds.push(item.id);
          });
        } else if (plateData.objects) {
          plateData.objects.forEach((item) => {
            if (item.id !== void 0) objectIds.push(item.id);
          });
        }
        plates.push({ id: plateNum, name: `Plate ${plateNum}`, objectIds });
        plateObjectMap.set(plateNum, objectIds);
      } catch {
      }
    }
  }
  if (plates.length === 0) {
    const filamentSeqFile = zipContent.file("Metadata/filament_sequence.json");
    if (filamentSeqFile) {
      try {
        const content = await filamentSeqFile.async("text");
        const seq = JSON.parse(content);
        const plateKeys = Object.keys(seq).filter((k) => k.startsWith("plate_"));
        for (const key of plateKeys) {
          const plateNum = parseInt(key.replace("plate_", "")) || 0;
          if (plateNum > 0) {
            plates.push({ id: plateNum, name: `Plate ${plateNum}`, objectIds: [] });
            plateObjectMap.set(plateNum, []);
          }
        }
      } catch {
      }
    }
  }
  return { plates, plateObjectMap };
}
async function parsePrusaSlicerMetadata(zipContent) {
  const volumeRanges = [];
  const extruderColors = [];
  const configFiles = Object.keys(zipContent.files).filter(
    (f) => f.includes("Slic3r") && f.endsWith(".config")
  );
  if (configFiles.length === 0) return { volumeRanges, extruderColors };
  const modelConfigFile = configFiles.find((f) => f.includes("model"));
  if (modelConfigFile) {
    try {
      const content = await zipContent.file(modelConfigFile)?.async("text");
      if (content) {
        const parser = new DOMParser();
        const configDoc = parser.parseFromString(content, "text/xml");
        configDoc.querySelectorAll("volume").forEach((volume) => {
          const firstid = parseInt(volume.getAttribute("firstid") || "-1");
          const lastid = parseInt(volume.getAttribute("lastid") || "-1");
          if (firstid < 0 || lastid < 0) return;
          let extruder = 1;
          for (const meta of Array.from(volume.querySelectorAll("metadata"))) {
            if (meta.getAttribute("key") === "extruder") {
              extruder = parseInt(meta.getAttribute("value") || meta.textContent || "1");
            }
          }
          volumeRanges.push({ firstid, lastid, extruder });
        });
      }
    } catch {
    }
  }
  for (const configFile of configFiles) {
    if (configFile === modelConfigFile) continue;
    try {
      const content = await zipContent.file(configFile)?.async("text");
      if (!content) continue;
      const match = content.match(/extruder_colou?r\s*=\s*(.+)/i);
      if (match) {
        extruderColors.push(...match[1].split(";").map((c) => normalizeColor(c.trim())));
        break;
      }
    } catch {
    }
  }
  return { volumeRanges, extruderColors };
}
function paintHexToBits(hexStr) {
  const bits = [];
  for (let i = hexStr.length - 1; i >= 0; i--) {
    const ch = hexStr.charCodeAt(i);
    let dec = 0;
    if (ch >= 48 && ch <= 57) dec = ch - 48;
    else if (ch >= 65 && ch <= 70) dec = 10 + ch - 65;
    else if (ch >= 97 && ch <= 102) dec = 10 + ch - 97;
    for (let b = 0; b < 4; b++) bits.push(dec >> b & 1);
  }
  return bits;
}
function decodePaintTreeNode(bits, pos, depth) {
  if (pos.i + 1 >= bits.length || depth > 20) return 0;
  const splitSides = bits[pos.i] + bits[pos.i + 1] * 2;
  pos.i += 2;
  if (splitSides > 0) {
    if (pos.i + 1 >= bits.length) return 0;
    pos.i += 2;
    const childStates = [];
    for (let c = splitSides; c >= 0; c--) {
      childStates.push(decodePaintTreeNode(bits, pos, depth + 1));
    }
    const counts = /* @__PURE__ */ new Map();
    for (const s of childStates) {
      if (s > 0) counts.set(s, (counts.get(s) || 0) + 1);
    }
    let best = 0, bestCount = 0;
    counts.forEach((count, state) => {
      if (count > bestCount) {
        bestCount = count;
        best = state;
      }
    });
    return best;
  } else {
    if (pos.i + 1 >= bits.length) return 0;
    const xx = bits[pos.i] + bits[pos.i + 1] * 2;
    pos.i += 2;
    if (xx < 3) return xx;
    let n = 0;
    while (pos.i + 3 < bits.length) {
      let nibble = 0;
      for (let b = 0; b < 4; b++) nibble |= bits[pos.i + b] << b;
      pos.i += 4;
      if (nibble === 15) {
        n += 15;
      } else {
        n += nibble;
        break;
      }
    }
    return 3 + n;
  }
}
function decodePaintColorAttr(hexStr) {
  if (!hexStr || hexStr.length === 0) return 0;
  const bits = paintHexToBits(hexStr);
  const pos = { i: 0 };
  return decodePaintTreeNode(bits, pos, 0);
}
async function parse3MF(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const zip = new JSZip();
    const zipContent = await zip.loadAsync(arrayBuffer);
    const zipFiles = Object.keys(zipContent.files);
    let mainModelPath = "3D/3dmodel.model";
    let mainModelFile = zipContent.file(mainModelPath);
    if (!mainModelFile) {
      mainModelPath = "3D/3dModel.model";
      mainModelFile = zipContent.file(mainModelPath);
    }
    if (!mainModelFile) {
      const modelFiles = zipFiles.filter((f) => f.endsWith(".model") && f.startsWith("3D/"));
      if (modelFiles.length > 0) {
        mainModelPath = modelFiles[0];
        mainModelFile = zipContent.file(mainModelPath);
      }
    }
    if (!mainModelFile) throw new ThreeMFParseError("Invalid .3MF file: no model file found");
    const mainXML = await mainModelFile.async("text");
    const domParser = new DOMParser();
    const mainDoc = domParser.parseFromString(mainXML, "text/xml");
    const mainResources = parseResources(mainDoc);
    const buildItems = [];
    const buildElems = findElements(mainDoc, "build");
    if (buildElems.length > 0) {
      for (const item of findElements(buildElems[0], "item")) {
        const objectId = parseInt(item.getAttribute("objectid") || "0");
        if (objectId > 0) {
          buildItems.push({ objectId, transform: item.getAttribute("transform") || void 0 });
        }
      }
    }
    const compositeToGeometryMap = /* @__PURE__ */ new Map();
    const componentColorOverrides = /* @__PURE__ */ new Map();
    for (const objElem of findElements(mainDoc, "object")) {
      const objId = parseInt(objElem.getAttribute("id") || "0");
      if (objId <= 0) continue;
      const components = parseComponents(objElem);
      if (components.length === 0) continue;
      const geomIds = [];
      for (const comp of components) {
        geomIds.push(comp.objectId);
        if (comp.pid) {
          const overrideColor = resolveColor(comp.pid, comp.pindex || 0, mainResources);
          if (overrideColor) componentColorOverrides.set(comp.objectId, overrideColor);
        }
      }
      compositeToGeometryMap.set(objId, geomIds);
    }
    let allGeomObjects = [];
    const mainGeomObjects = parseGeometryObjects(mainDoc, mainResources);
    allGeomObjects.push(...mainGeomObjects);
    const externalObjectFiles = zipFiles.filter((f) => f.startsWith("3D/Objects/") && f.endsWith(".model")).sort();
    const externalIdRemap = /* @__PURE__ */ new Map();
    if (externalObjectFiles.length > 0) {
      const mainGeomIds = new Set(mainGeomObjects.map((o) => o.id));
      for (const filePath of externalObjectFiles) {
        const fileIdMatch = filePath.match(/object_(\d+)\.model/);
        const fileId = fileIdMatch ? parseInt(fileIdMatch[1]) : 0;
        if (mainGeomIds.has(fileId)) continue;
        const extFile = zipContent.file(filePath);
        if (!extFile) continue;
        const xml = await extFile.async("text");
        const doc = domParser.parseFromString(xml, "text/xml");
        const fileResources = parseResources(doc);
        let componentOverride = componentColorOverrides.get(fileId) || null;
        if (!componentOverride) {
          for (const [compObjId, color] of componentColorOverrides) {
            if (compositeToGeometryMap.has(compObjId)) continue;
            componentOverride = color;
            break;
          }
        }
        const mergedResources = new Map(mainResources);
        fileResources.forEach((res, id) => mergedResources.set(id, res));
        const fileObjects = parseGeometryObjects(doc, mergedResources, componentOverride);
        for (const obj of fileObjects) {
          const mappedId = fileObjects.length === 1 && fileId > 0 ? fileId : obj.id;
          allGeomObjects.push({ ...obj, id: mappedId, sourceFile: filePath });
          if (mappedId !== obj.id) externalIdRemap.set(obj.id, mappedId);
        }
      }
    }
    if (externalIdRemap.size > 0) {
      compositeToGeometryMap.forEach((geomIds, compositeId) => {
        compositeToGeometryMap.set(
          compositeId,
          geomIds.map((id) => externalIdRemap.get(id) ?? id)
        );
      });
    }
    if (allGeomObjects.length === 0) {
      throw new ThreeMFParseError("No geometry objects found in 3MF file");
    }
    const modelSettings = await parseModelSettings(zipContent);
    const allModelFiles = zipFiles.filter((f) => f.endsWith(".model"));
    for (const modelPath of allModelFiles) {
      try {
        const modelFile = zipContent.file(modelPath);
        if (!modelFile) continue;
        const xml = await modelFile.async("text");
        const paintingKeywords = ["mmu_segmentation", "paint_color", "mmu_painting", "FacePainting", "face_property"];
        for (const keyword of paintingKeywords) {
          if (xml.includes(keyword)) modelSettings.hasMmuSegmentation = true;
        }
      } catch {
      }
    }
    const filamentData = await extractFilamentColors(zipContent);
    const filamentColors = filamentData.colors;
    const filamentCount = filamentData.filamentCount;
    const hasMultipleExtruders = modelSettings.distinctExtruders.size > 1;
    const hasMultipleFilaments = filamentCount > 1;
    if (modelSettings.objectExtruderMap.size > 0 && filamentColors.length > 0) {
      allGeomObjects.forEach((obj) => {
        let extruder = modelSettings.objectExtruderMap.get(obj.id);
        if (extruder === void 0) {
          compositeToGeometryMap.forEach((geomIds, compositeId) => {
            if (geomIds.includes(obj.id)) {
              const cExt = modelSettings.objectExtruderMap.get(compositeId);
              if (cExt !== void 0) extruder = cExt;
            }
          });
        }
        if (extruder === void 0 && obj.sourceFile) {
          const fMatch = obj.sourceFile.match(/object_(\d+)\.model/);
          const fId = fMatch ? parseInt(fMatch[1]) : 0;
          if (fId > 0 && fId !== obj.id) extruder = modelSettings.objectExtruderMap.get(fId);
        }
        if (extruder !== void 0 && extruder > 0 && extruder <= filamentColors.length) {
          const color = filamentColors[extruder - 1];
          if (!obj.triangles.some((t) => t.colorHex !== null)) {
            obj.triangles.forEach((t) => {
              t.colorHex = color;
            });
          }
        }
      });
    }
    const prusaData = await parsePrusaSlicerMetadata(zipContent);
    if (prusaData.volumeRanges.length > 0 && prusaData.extruderColors.length > 0) {
      let globalTriOffset = 0;
      allGeomObjects.forEach((obj) => {
        if (obj.triangles.some((t) => t.colorHex !== null)) {
          globalTriOffset += obj.triangles.length;
          return;
        }
        for (let i = 0; i < obj.triangles.length; i++) {
          const globalIdx = globalTriOffset + i;
          for (const range of prusaData.volumeRanges) {
            if (globalIdx >= range.firstid && globalIdx <= range.lastid) {
              const color = prusaData.extruderColors[range.extruder - 1];
              if (color) obj.triangles[i].colorHex = color;
              break;
            }
          }
        }
        globalTriOffset += obj.triangles.length;
      });
    }
    if (filamentColors.length >= 1) {
      for (const obj of allGeomObjects) {
        if (!obj.triangles.some((t) => t.paintAttr)) continue;
        let defaultColor = filamentColors[0];
        let objExtruder = modelSettings.objectExtruderMap.get(obj.id);
        if (objExtruder === void 0) {
          compositeToGeometryMap.forEach((geomIds, compositeId) => {
            if (geomIds.includes(obj.id)) {
              const cExt = modelSettings.objectExtruderMap.get(compositeId);
              if (cExt !== void 0) objExtruder = cExt;
            }
          });
        }
        if (objExtruder !== void 0 && objExtruder > 0 && objExtruder <= filamentColors.length) {
          defaultColor = filamentColors[objExtruder - 1];
        }
        for (const tri of obj.triangles) {
          if (tri.paintAttr) {
            const state = decodePaintColorAttr(tri.paintAttr);
            if (state > 0 && state <= filamentColors.length) {
              tri.colorHex = filamentColors[state - 1];
            } else if (state > 0) {
              tri.colorHex = filamentColors[filamentColors.length - 1];
            } else {
              tri.colorHex = defaultColor;
            }
          } else if (tri.colorHex === null) {
            tri.colorHex = defaultColor;
          }
        }
      }
    }
    const totalColoredTriangles = allGeomObjects.reduce(
      (sum, obj) => sum + obj.triangles.filter((t) => t.colorHex !== null).length,
      0
    );
    if (totalColoredTriangles === 0 && filamentColors.length > 1 && allGeomObjects.length > 1) {
      if (modelSettings.hasMmuSegmentation || hasMultipleExtruders) {
        allGeomObjects.forEach((obj, idx) => {
          const color = filamentColors[idx % filamentColors.length];
          obj.triangles.forEach((t) => {
            t.colorHex = color;
          });
        });
      }
    }
    const geometries = [];
    const objectIdToGeometryIndex = /* @__PURE__ */ new Map();
    const triangleMaterialMaps = /* @__PURE__ */ new Map();
    const allUniqueColors = /* @__PURE__ */ new Set();
    let totalVolume = 0;
    let globalBoundingBox = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < allGeomObjects.length; i++) {
      const obj = allGeomObjects[i];
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(new Float32Array(obj.vertices), 3));
      const indices = new Uint32Array(obj.triangles.length * 3);
      const triColorMap = /* @__PURE__ */ new Map();
      let hasAnyColor = false;
      for (let t = 0; t < obj.triangles.length; t++) {
        const tri = obj.triangles[t];
        indices[t * 3] = tri.v1;
        indices[t * 3 + 1] = tri.v2;
        indices[t * 3 + 2] = tri.v3;
        if (tri.colorHex) {
          triColorMap.set(t, tri.colorHex);
          allUniqueColors.add(tri.colorHex);
          hasAnyColor = true;
        }
      }
      geometry.setIndex(new BufferAttribute(indices, 1));
      geometry.computeVertexNormals();
      geometries.push(geometry);
      objectIdToGeometryIndex.set(obj.id, i);
      if (hasAnyColor) triangleMaterialMaps.set(i, triColorMap);
      try {
        totalVolume += calculateVolume(geometry);
        const bbox = calculateBoundingBox(geometry);
        globalBoundingBox.x = Math.max(globalBoundingBox.x, bbox.x);
        globalBoundingBox.y = Math.max(globalBoundingBox.y, bbox.y);
        globalBoundingBox.z = Math.max(globalBoundingBox.z, bbox.z);
      } catch {
      }
    }
    compositeToGeometryMap.forEach((geomIds, compositeId) => {
      if (!objectIdToGeometryIndex.has(compositeId)) {
        const firstIdx = objectIdToGeometryIndex.get(geomIds[0]);
        if (firstIdx !== void 0) objectIdToGeometryIndex.set(compositeId, firstIdx);
      }
    });
    const colorArray = Array.from(allUniqueColors).sort();
    const materialSlots = [];
    const isMultiColorFromColors = colorArray.length > 1;
    const isMultiColorFromExtruders = hasMultipleExtruders && filamentColors.length > 1;
    const isMultiColorFromPainting = modelSettings.hasMmuSegmentation;
    const isMultiColorFromPrusa = prusaData.volumeRanges.length > 0 && new Set(prusaData.volumeRanges.map((r) => r.extruder)).size > 1;
    const isMultiColorFromFilamentConfig = hasMultipleFilaments || filamentColors.length > 1;
    const isMultiColor = isMultiColorFromColors || isMultiColorFromExtruders || isMultiColorFromPainting || isMultiColorFromPrusa || isMultiColorFromFilamentConfig;
    if (colorArray.length > 1) {
      colorArray.forEach((colorHex, idx) => {
        const objectIds = [];
        triangleMaterialMaps.forEach((triMap, geomIdx) => {
          for (const c of triMap.values()) {
            if (c === colorHex) {
              objectIds.push(geomIdx);
              break;
            }
          }
        });
        if (objectIds.length === 0) objectIds.push(...geometries.map((_, i) => i));
        materialSlots.push({ id: colorHex, name: `Color ${idx + 1}`, objectIds, selectedColor: colorHex });
      });
    } else if (filamentColors.length > 1) {
      filamentColors.forEach((color, idx) => {
        const objectIds = [];
        allGeomObjects.forEach((obj, geomIdx) => {
          if (obj.triangles.length > 0 && obj.triangles[0].colorHex === color) objectIds.push(geomIdx);
        });
        if (objectIds.length === 0) objectIds.push(...geometries.map((_, i) => i));
        materialSlots.push({ id: color, name: `Filament ${idx + 1}`, objectIds, selectedColor: color });
      });
    } else if (filamentCount > 1 && filamentColors.length === 0) {
      const defaultSlotColors = ["#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF", "#FF8000", "#8000FF"];
      for (let i = 0; i < filamentCount; i++) {
        const slotColor = i < defaultSlotColors.length ? defaultSlotColors[i] : `#${(i * 37 % 256).toString(16).padStart(2, "0")}80FF`;
        materialSlots.push({
          id: `filament_${i + 1}`,
          name: `Filament ${i + 1}`,
          objectIds: geometries.map((_, gi) => gi),
          selectedColor: slotColor
        });
      }
    } else if (isMultiColor && prusaData.extruderColors.length > 1) {
      prusaData.extruderColors.forEach((color, idx) => {
        materialSlots.push({
          id: color,
          name: `Extruder ${idx + 1}`,
          objectIds: geometries.map((_, i) => i),
          selectedColor: color
        });
      });
    } else {
      materialSlots.push({
        id: "default",
        name: "Material 1",
        objectIds: geometries.map((_, i) => i),
        selectedColor: "#FFFFFF"
      });
    }
    let { plates, plateObjectMap } = await parseBambuPlates(zipContent);
    if (plates.length > 0) {
      const hasEmpty = plates.some((p) => p.objectIds.length === 0);
      if (hasEmpty) {
        const allIds = buildItems.length > 0 ? buildItems.map((b) => b.objectId) : allGeomObjects.map((o) => o.id);
        plates.forEach((p) => {
          if (p.objectIds.length === 0) {
            p.objectIds = [...allIds];
            plateObjectMap.set(p.id, [...allIds]);
          }
        });
      }
    }
    if (plates.length === 0) {
      const allObjectIds = allGeomObjects.map((o) => o.id);
      plates = [{ id: 1, name: "Plate 1", objectIds: allObjectIds }];
      plateObjectMap = /* @__PURE__ */ new Map([[1, allObjectIds]]);
    }
    return {
      volume: totalVolume,
      boundingBox: globalBoundingBox,
      materialSlots,
      isMultiColor,
      metadata: {},
      geometries,
      triangleMaterialMaps: triangleMaterialMaps.size > 0 ? triangleMaterialMaps : void 0,
      plates: plates.length > 0 ? plates : void 0,
      plateObjectMap: plateObjectMap.size > 0 ? plateObjectMap : void 0,
      objectIdToGeometryIndex: objectIdToGeometryIndex.size > 0 ? objectIdToGeometryIndex : void 0,
      compositeToGeometryMap: compositeToGeometryMap.size > 0 ? compositeToGeometryMap : void 0
    };
  } catch (error) {
    if (error instanceof ThreeMFParseError) throw error;
    throw new ThreeMFParseError(
      `Failed to parse .3MF file: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
var DEFAULT_COLOR_MAP = {
  White: "#F1F5F9",
  Black: "#1E293B",
  Red: "#EF4444",
  Blue: "#3B82F6",
  Green: "#22C55E",
  Yellow: "#EAB308",
  Orange: "#F97316",
  Grey: "#64748B",
  Clear: "#E0F2FE"
};
function resolveToHex(color, colorOptions) {
  if (color.startsWith("#")) {
    let c = color.toUpperCase();
    if (c.length === 4) c = `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
    if (c.length === 9) c = c.substring(0, 7);
    return c;
  }
  if (colorOptions) {
    const opt = colorOptions.find((o) => o.name === color);
    if (opt) return opt.hex.toUpperCase();
  }
  const hex = DEFAULT_COLOR_MAP[color];
  return hex ? hex.toUpperCase() : "#808080";
}
function normalizeColor2(color) {
  if (!color || color.trim() === "") return "#808080";
  let c = color.trim();
  if (!c.startsWith("#")) c = "#" + c;
  if (c.length === 9) c = c.substring(0, 7);
  return c.toUpperCase();
}
function hexPattern(hex6) {
  const body = hex6.slice(1);
  return new RegExp(
    "#" + body + "([0-9a-fA-F]{2})?(?![0-9a-fA-F])",
    "gi"
  );
}
function replaceHex(text, oldHex, newHex) {
  return text.replace(hexPattern(oldHex), (_match, alpha) => {
    return newHex + (alpha || "");
  });
}
async function extractConfigFilamentColors(zipContent) {
  for (const path of ["Metadata/project_settings.config", "Metadata/Project_settings.config"]) {
    const file = zipContent.file(path);
    if (!file) continue;
    try {
      const content = await file.async("text");
      const trimmed = content.trim();
      if (trimmed.startsWith("{")) {
        try {
          const json = JSON.parse(trimmed);
          const colorKey = Object.keys(json).find(
            (k) => k.toLowerCase() === "filament_colour" || k.toLowerCase() === "filament_color"
          );
          if (colorKey) {
            const val = json[colorKey];
            if (Array.isArray(val)) {
              return val.map((c) => normalizeColor2(String(c)));
            }
            if (typeof val === "string") {
              return val.split(";").map((c) => c.trim()).filter((c) => c.length > 0).map((c) => normalizeColor2(c));
            }
          }
        } catch {
        }
      }
      const match = content.match(/filament_colou?r\s*=\s*(.+)/i);
      if (match) {
        return match[1].split(";").map((c) => c.trim()).filter((c) => c.length > 0).map((c) => normalizeColor2(c));
      }
    } catch {
      continue;
    }
  }
  return [];
}
function extractXmlColorValues(xml) {
  const colors = [];
  const basePattern = /<base\b[^>]*?displaycolor\s*=\s*["']([^"']*?)["'][^>]*?>/gi;
  let match;
  while ((match = basePattern.exec(xml)) !== null) {
    if (match[1]) colors.push(match[1]);
  }
  if (colors.length > 0) return colors;
  const colorPattern = /<color\b[^>]*?\bcolor\s*=\s*["']([^"']*?)["'][^>]*?>/gi;
  while ((match = colorPattern.exec(xml)) !== null) {
    if (match[1]) colors.push(match[1]);
  }
  return colors;
}
function buildModelRemap(xml, primaryRemap, configColors, materialSlots, colorOptions) {
  if (primaryRemap.size === 0) return primaryRemap;
  const expanded = new Map(primaryRemap);
  const xmlColors = extractXmlColorValues(xml);
  if (xmlColors.length === 0 || configColors.length === 0) return expanded;
  const len = Math.min(xmlColors.length, configColors.length);
  for (let i = 0; i < len; i++) {
    const xmlNorm = normalizeColor2(xmlColors[i]);
    const cfgNorm = configColors[i];
    const slot = materialSlots.find((s) => {
      if (!s.id.startsWith("#")) return false;
      const slotNorm2 = normalizeColor2(s.id);
      return slotNorm2 === cfgNorm || slotNorm2 === xmlNorm;
    });
    if (!slot) continue;
    const newHex = resolveToHex(slot.selectedColor, colorOptions);
    const slotNorm = normalizeColor2(slot.id);
    if (slotNorm === newHex) continue;
    if (!expanded.has(xmlNorm)) {
      expanded.set(xmlNorm, newHex);
    }
    if (!expanded.has(cfgNorm)) {
      expanded.set(cfgNorm, newHex);
    }
  }
  return expanded;
}
async function export3MF(options) {
  const { originalFile, materialSlots, colorOptions } = options;
  const arrayBuffer = originalFile instanceof ArrayBuffer ? originalFile : await originalFile.arrayBuffer();
  const zip = new JSZip();
  const zipContent = await zip.loadAsync(arrayBuffer);
  const colorRemap = /* @__PURE__ */ new Map();
  for (const slot of materialSlots) {
    if (!slot.id.startsWith("#")) continue;
    const originalNorm = normalizeColor2(slot.id);
    const newHex = resolveToHex(slot.selectedColor, colorOptions);
    if (originalNorm !== newHex) {
      colorRemap.set(originalNorm, newHex);
    }
  }
  if (colorRemap.size === 0) {
    return new Blob([arrayBuffer], {
      type: "application/vnd.ms-package.3dmanufacturing-3dmodel+xml"
    });
  }
  const configColors = await extractConfigFilamentColors(zipContent);
  let comprehensiveRemap = colorRemap;
  const modelFiles = Object.keys(zipContent.files).filter(
    (f) => f.endsWith(".model") && f.startsWith("3D/")
  );
  for (const modelPath of modelFiles) {
    const modelFile = zipContent.file(modelPath);
    if (!modelFile) continue;
    const xml = await modelFile.async("text");
    const modelRemap = buildModelRemap(xml, colorRemap, configColors, materialSlots, colorOptions);
    if (modelRemap.size > colorRemap.size) {
      comprehensiveRemap = new Map([...comprehensiveRemap, ...modelRemap]);
    }
    const patched = patchModelXmlColors(xml, modelRemap);
    if (patched !== xml) {
      zipContent.file(modelPath, patched);
    }
  }
  for (const configPath of [
    "Metadata/project_settings.config",
    "Metadata/Project_settings.config"
  ]) {
    const configFile = zipContent.file(configPath);
    if (!configFile) continue;
    try {
      const content = await configFile.async("text");
      const patched = patchProjectSettingsColors(content, comprehensiveRemap);
      if (patched !== content) {
        zipContent.file(configPath, patched);
      }
    } catch {
    }
  }
  const sliceInfoFile = zipContent.file("Metadata/slice_info.config");
  if (sliceInfoFile) {
    try {
      const content = await sliceInfoFile.async("text");
      const patched = patchSliceInfoColors(content, comprehensiveRemap);
      if (patched !== content) {
        zipContent.file("Metadata/slice_info.config", patched);
      }
    } catch {
    }
  }
  const slicerConfigs = Object.keys(zipContent.files).filter(
    (f) => f.includes("Slic3r") && f.endsWith(".config")
  );
  for (const configPath of slicerConfigs) {
    const configFile = zipContent.file(configPath);
    if (!configFile) continue;
    try {
      const content = await configFile.async("text");
      const patched = patchPrusaSlicerColors(content, comprehensiveRemap);
      if (patched !== content) {
        zipContent.file(configPath, patched);
      }
    } catch {
    }
  }
  const blob = await zipContent.generateAsync({
    type: "blob",
    mimeType: "application/vnd.ms-package.3dmanufacturing-3dmodel+xml"
  });
  return blob;
}
function patchModelXmlColors(xml, remap) {
  if (remap.size === 0) return xml;
  let result = xml;
  result = patchAttrInTag(result, "base", "displaycolor", remap);
  result = patchAttrInTag(result, "color", "color", remap);
  return result;
}
function patchAttrInTag(xml, tagName, attrName, remap) {
  const tagPattern = new RegExp(
    `(<${tagName}\\b)([^>]*>)`,
    "gi"
  );
  return xml.replace(tagPattern, (fullTag, tagOpen, rest) => {
    const attrPattern = new RegExp(
      `(\\b${attrName}\\s*=\\s*(["']))([^"']*?)(\\2)`,
      "gi"
    );
    const newRest = rest.replace(attrPattern, (attrMatch, prefix, _quote, colorVal, closingQuote) => {
      const normalized = normalizeColor2(colorVal);
      const replacement = remap.get(normalized);
      if (!replacement) return attrMatch;
      const newVal = preserveAlpha(colorVal, replacement);
      return prefix + newVal + closingQuote;
    });
    return tagOpen + newRest;
  });
}
function preserveAlpha(originalVal, newHex) {
  const trimmed = originalVal.trim();
  const withHash = trimmed.startsWith("#") ? trimmed : "#" + trimmed;
  if (withHash.length === 9) {
    return newHex + withHash.slice(7);
  }
  return newHex;
}
function patchProjectSettingsColors(content, remap) {
  if (remap.size === 0) return content;
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) {
    return patchJsonFilamentColors(content, remap);
  }
  return patchIniColorLine(content, remap);
}
function patchJsonFilamentColors(content, remap) {
  const pattern = /("filament_colou?r"\s*:\s*\[)([^\]]*?)(\])/gi;
  return content.replace(pattern, (fullMatch, prefix, arrayContent, suffix) => {
    let newContent = arrayContent;
    for (const [oldHex, newHex] of remap) {
      newContent = replaceHex(newContent, oldHex, newHex);
    }
    return prefix + newContent + suffix;
  });
}
function patchIniColorLine(content, remap) {
  return content.replace(
    /^(filament_colou?r\s*=\s*)(.+)$/gim,
    (_fullMatch, prefix, colorsLine) => {
      let newLine = colorsLine;
      for (const [oldHex, newHex] of remap) {
        newLine = replaceHex(newLine, oldHex, newHex);
      }
      return prefix + newLine;
    }
  );
}
function patchSliceInfoColors(content, remap) {
  if (remap.size === 0) return content;
  return patchAttrInTag(content, "filament", "color", remap);
}
function patchPrusaSlicerColors(content, remap) {
  if (remap.size === 0) return content;
  return content.replace(
    /^((?:extruder|filament)_colou?r\s*=\s*)(.+)$/gim,
    (_fullMatch, prefix, colorsLine) => {
      let newLine = colorsLine;
      for (const [oldHex, newHex] of remap) {
        newLine = replaceHex(newLine, oldHex, newHex);
      }
      return prefix + newLine;
    }
  );
}
async function download3MF(options) {
  const blob = await export3MF(options);
  const defaultName = options.originalFile instanceof File ? options.originalFile.name.replace(/\.3mf$/i, "") + "_modified" : "model_modified";
  const filename = (options.filename || defaultName) + ".3mf";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export { ThreeMFParseError, calculateBoundingBox, calculateVolume, download3MF, export3MF, parse3MF };
//# sourceMappingURL=core.js.map
//# sourceMappingURL=core.js.map