import * as THREE from 'three';
import { Vector3, BufferGeometry, BufferAttribute } from 'three';
import JSZip from 'jszip';
import { createContext, useReducer, useRef, useCallback, useEffect, useContext, useState, useMemo } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

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
function reducer(state, action) {
  switch (action.type) {
    case "PARSE_START":
      return { ...state, loading: true, error: null };
    case "PARSE_SUCCESS": {
      const m = action.payload;
      return {
        ...state,
        model: m,
        loading: false,
        error: null,
        materialSlots: m.materialSlots,
        selectedPlateId: m.plates?.[0]?.id ?? null
      };
    }
    case "PARSE_ERROR":
      return { ...state, loading: false, error: action.payload, model: null, materialSlots: [] };
    case "SET_SLOT_COLOR":
      return {
        ...state,
        materialSlots: state.materialSlots.map(
          (s) => s.id === action.slotId ? { ...s, selectedColor: action.color } : s
        )
      };
    case "SET_PLATE":
      return { ...state, selectedPlateId: action.plateId };
    case "SET_COLOR":
      return { ...state, color: action.color };
    case "RESET":
      return initialState;
    default:
      return state;
  }
}
var initialState = {
  model: null,
  loading: false,
  error: null,
  selectedPlateId: null,
  materialSlots: [],
  color: "#f1f5f9"
};
var Ctx = createContext(null);
function ThreeMFProvider({
  children,
  onParsed,
  onError,
  onSlotColorChange,
  onPlateChange
}) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const callbackRefs = useRef({ onParsed, onError, onSlotColorChange, onPlateChange });
  callbackRefs.current = { onParsed, onError, onSlotColorChange, onPlateChange };
  const loadFile = useCallback(async (file) => {
    dispatch({ type: "PARSE_START" });
    try {
      const result = await parse3MF(file);
      dispatch({ type: "PARSE_SUCCESS", payload: result });
      callbackRefs.current.onParsed?.(result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      dispatch({ type: "PARSE_ERROR", payload: error });
      callbackRefs.current.onError?.(error);
      return null;
    }
  }, []);
  const setSlotColor = useCallback((slotId, color) => {
    dispatch({ type: "SET_SLOT_COLOR", slotId, color });
  }, []);
  useEffect(() => {
    if (state.materialSlots.length > 0) ;
  }, [state.materialSlots]);
  const selectPlate = useCallback((plateId) => {
    dispatch({ type: "SET_PLATE", plateId });
    if (plateId !== null) callbackRefs.current.onPlateChange?.(plateId);
  }, []);
  const setColor = useCallback((color) => {
    dispatch({ type: "SET_COLOR", color });
  }, []);
  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);
  const value = {
    ...state,
    loadFile,
    setSlotColor,
    selectPlate,
    setColor,
    reset,
    isMultiColor: state.model?.isMultiColor ?? false,
    plates: state.model?.plates ?? [],
    geometries: state.model?.geometries ?? [],
    triangleMaterialMaps: state.model?.triangleMaterialMaps,
    objectIdToGeometryIndex: state.model?.objectIdToGeometryIndex,
    compositeToGeometryMap: state.model?.compositeToGeometryMap,
    plateObjectMap: state.model?.plateObjectMap
  };
  return /* @__PURE__ */ jsx(Ctx.Provider, { value, children });
}
function useThreeMF() {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useThreeMF() must be used inside <ThreeMFProvider>");
  }
  return ctx;
}

// src/styles/theme.ts
var DEFAULT_THEME = {
  background: "#0f172a",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  accent: "#3b82f6",
  surface: "#1e293b",
  text: "#e2e8f0",
  textMuted: "#94a3b8",
  border: "rgba(59,130,246,0.3)"
};
var DEFAULT_COLOR_OPTIONS = [
  { name: "White", hex: "#f1f5f9" },
  { name: "Black", hex: "#1e293b" },
  { name: "Red", hex: "#ef4444" },
  { name: "Blue", hex: "#3b82f6" },
  { name: "Green", hex: "#22c55e" },
  { name: "Yellow", hex: "#eab308" },
  { name: "Orange", hex: "#f97316" },
  { name: "Grey", hex: "#64748b" }
];
function resolveTheme(overrides) {
  return { ...DEFAULT_THEME, ...overrides };
}
function colorToHex(v) {
  if (v.startsWith("#")) return parseInt(v.slice(1), 16);
  const opt = DEFAULT_COLOR_OPTIONS.find((o) => o.name === v);
  return opt ? parseInt(opt.hex.slice(1), 16) : 3900150;
}
function colorToCss(v) {
  if (v.startsWith("#")) return v;
  const opt = DEFAULT_COLOR_OPTIONS.find((o) => o.name === v);
  return opt ? opt.hex : "#94a3b8";
}
function buildMultiMaterialGeometry(src, triColorMap, slots) {
  const idx = src.index;
  const pos = src.attributes.position;
  if (!idx || !pos || slots.length === 0) return null;
  const arr = idx.array;
  const triCount = idx.count / 3;
  const c2s = /* @__PURE__ */ new Map();
  slots.forEach((s, i) => c2s.set(s.id, i));
  const buckets = slots.map(() => []);
  for (let t = 0; t < triCount; t++) {
    const hex = triColorMap.get(t);
    if (hex === void 0) {
      buckets[0].push(t);
    } else {
      const si = c2s.get(hex);
      if (si !== void 0) buckets[si].push(t);
      else buckets[0].push(t);
    }
  }
  const sortedIndices = new Uint32Array(triCount * 3);
  const groups = [];
  const slotOrder = [];
  let writeOffset = 0;
  for (let si = 0; si < slots.length; si++) {
    const bucket = buckets[si];
    if (bucket.length === 0) continue;
    const groupStart = writeOffset * 3;
    for (const triIdx of bucket) {
      const base = triIdx * 3;
      sortedIndices[writeOffset * 3] = arr[base];
      sortedIndices[writeOffset * 3 + 1] = arr[base + 1];
      sortedIndices[writeOffset * 3 + 2] = arr[base + 2];
      writeOffset++;
    }
    groups.push({ start: groupStart, count: bucket.length * 3, materialIndex: groups.length });
    slotOrder.push(si);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", pos.clone());
  if (src.attributes.normal) geom.setAttribute("normal", src.attributes.normal.clone());
  geom.setIndex(new BufferAttribute(sortedIndices, 1));
  for (const g of groups) geom.addGroup(g.start, g.count, g.materialIndex);
  geom.computeVertexNormals();
  const materials = slotOrder.map(
    (si) => new THREE.MeshPhongMaterial({ color: colorToHex(slots[si].selectedColor), specular: 1118481, shininess: 200 })
  );
  return { geometry: geom, materials, slotOrder };
}
function centerAndScale(meshes, scene) {
  if (meshes.length === 0) return;
  const tmp = new THREE.Group();
  meshes.forEach((m) => tmp.add(m));
  const box = new THREE.Box3().setFromObject(tmp);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = maxDim > 0 ? 100 / maxDim : 1;
  meshes.forEach((m) => {
    tmp.remove(m);
    m.position.sub(center);
    m.scale.setScalar(scale);
    scene.add(m);
  });
}
function makeMaterial(hex) {
  return new THREE.MeshPhongMaterial({ color: hex, specular: 1118481, shininess: 200 });
}
function Viewer({ theme: themeOverrides, className, style, showDebugOverlay }) {
  const containerRef = useRef(null);
  const theme = resolveTheme(themeOverrides);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const rafRef = useRef(0);
  const meshesRef = useRef([]);
  const slotOrderRef = useRef(/* @__PURE__ */ new Map());
  const ownedGeomsRef = useRef(/* @__PURE__ */ new Set());
  const [debugInfo, setDebugInfo] = useState("");
  const {
    model,
    loading,
    error,
    geometries,
    materialSlots,
    isMultiColor,
    triangleMaterialMaps,
    selectedPlateId,
    plates,
    plateObjectMap,
    objectIdToGeometryIndex,
    compositeToGeometryMap,
    color
  } = useThreeMF();
  const slotsRef = useRef(materialSlots);
  slotsRef.current = materialSlots;
  const { filteredGeometries, originalIndices } = useMemo(() => {
    const all = geometries ?? [];
    const fallback = {
      filteredGeometries: all,
      originalIndices: all.map((_, i) => i)
    };
    if (!geometries || !plates?.length || !selectedPlateId || !plateObjectMap || !objectIdToGeometryIndex)
      return fallback;
    const plate = plates.find((p) => p.id === selectedPlateId);
    if (!plate) return fallback;
    const objIds = plateObjectMap?.get(selectedPlateId) ?? plate.objectIds;
    if (!objIds?.length) return fallback;
    const gSet = /* @__PURE__ */ new Set();
    for (const oid of objIds) {
      const direct = objectIdToGeometryIndex?.get(oid);
      if (direct !== void 0) {
        gSet.add(direct);
        continue;
      }
      if (compositeToGeometryMap) {
        const children = compositeToGeometryMap.get(oid);
        if (children) {
          children.forEach((cid) => {
            const ci = objectIdToGeometryIndex?.get(cid);
            if (ci !== void 0) gSet.add(ci);
          });
          continue;
        }
      }
    }
    if (gSet.size === 0) return fallback;
    const sorted = [...gSet].sort((a, b) => a - b);
    return {
      filteredGeometries: sorted.map((i) => geometries[i]).filter(Boolean),
      originalIndices: sorted.filter((i) => !!geometries[i])
    };
  }, [geometries, plates, selectedPlateId, plateObjectMap, objectIdToGeometryIndex, compositeToGeometryMap]);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(theme.background);
    const w = el.clientWidth || 300;
    const h = el.clientHeight || 300;
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 2e3);
    camera.position.z = 150;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(window.devicePixelRatio);
    el.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    scene.add(new THREE.AmbientLight(16777215, 0.5));
    const d1 = new THREE.DirectionalLight(16777215, 0.8);
    d1.position.set(1, 1, 1);
    scene.add(d1);
    const d2 = new THREE.DirectionalLight(16777215, 0.5);
    d2.position.set(-1, -1, -1);
    scene.add(d2);
    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    controlsRef.current = controls;
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      controlsRef.current = null;
    };
  }, []);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    for (const m of meshesRef.current) {
      scene.remove(m);
      if (ownedGeomsRef.current.has(m.geometry)) {
        m.geometry.dispose();
        ownedGeomsRef.current.delete(m.geometry);
      }
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((mt) => mt.dispose());
      else mat.dispose();
    }
    meshesRef.current = [];
    slotOrderRef.current.clear();
    try {
      const slots = slotsRef.current;
      const clr = color;
      const newMeshes = [];
      const newSlotOrder = /* @__PURE__ */ new Map();
      if (filteredGeometries.length > 0) {
        for (let fi = 0; fi < filteredGeometries.length; fi++) {
          const geom = filteredGeometries[fi];
          if (!geom) continue;
          const oi = originalIndices[fi] ?? fi;
          if (isMultiColor && slots.length > 1) {
            const triMap = triangleMaterialMaps?.get(oi);
            if (triMap && triMap.size > 0) {
              const uniq = new Set(triMap.values());
              if (uniq.size > 1) {
                const result = buildMultiMaterialGeometry(geom, triMap, slots);
                if (result) {
                  ownedGeomsRef.current.add(result.geometry);
                  const mesh2 = new THREE.Mesh(result.geometry, result.materials);
                  newSlotOrder.set(newMeshes.length, result.slotOrder);
                  newMeshes.push(mesh2);
                  continue;
                }
              }
              const hex = [...uniq][0];
              const si = slots.findIndex((s) => s.id === hex);
              const slot = si >= 0 ? slots[si] : null;
              const mesh = new THREE.Mesh(geom, makeMaterial(colorToHex(slot?.selectedColor ?? hex)));
              if (si >= 0) newSlotOrder.set(newMeshes.length, [si]);
              newMeshes.push(mesh);
              continue;
            }
            const geomSlots = slots.map((s, i) => ({ s, i })).filter(({ s }) => s.objectIds.includes(oi));
            if (geomSlots.length > 0) {
              const { s: slot, i: si } = geomSlots[0];
              const mesh = new THREE.Mesh(geom, makeMaterial(colorToHex(slot.selectedColor)));
              newSlotOrder.set(newMeshes.length, [si]);
              newMeshes.push(mesh);
              continue;
            }
          }
          newMeshes.push(new THREE.Mesh(geom, makeMaterial(colorToHex(clr))));
        }
        meshesRef.current = newMeshes;
        slotOrderRef.current = newSlotOrder;
        centerAndScale(newMeshes, scene);
      }
      setDebugInfo(
        isMultiColor && slots.length > 1 ? `${slots.length} colors, ${newMeshes.length} mesh(es)` : `${newMeshes.length} mesh(es)`
      );
    } catch (e) {
      console.error("[Viewer] render error", e);
      setDebugInfo(`ERROR: ${e instanceof Error ? e.message : "unknown"}`);
    }
    const currentMeshes = meshesRef.current;
    const currentOwnedGeoms = ownedGeomsRef.current;
    return () => {
      for (const m of currentMeshes) {
        scene.remove(m);
        if (currentOwnedGeoms.has(m.geometry)) {
          m.geometry.dispose();
          currentOwnedGeoms.delete(m.geometry);
        }
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((mt) => mt.dispose());
        else mat.dispose();
      }
      meshesRef.current = [];
      slotOrderRef.current.clear();
    };
  }, [filteredGeometries, originalIndices, isMultiColor, materialSlots.length, triangleMaterialMaps, selectedPlateId]);
  useEffect(() => {
    if (meshesRef.current.length === 0) return;
    for (const [mi, order] of slotOrderRef.current) {
      const mesh = meshesRef.current[mi];
      if (!mesh) continue;
      const mat = mesh.material;
      if (Array.isArray(mat) && order.length === mat.length) {
        for (let gi = 0; gi < order.length; gi++) {
          const slot = materialSlots[order[gi]];
          if (slot && mat[gi]) mat[gi].color.setHex(colorToHex(slot.selectedColor));
        }
      } else if (order.length === 1) {
        const slot = materialSlots[order[0]];
        if (slot) {
          (Array.isArray(mat) ? mat[0] : mat).color.setHex(
            colorToHex(slot.selectedColor)
          );
        }
      }
    }
    if (!isMultiColor) {
      for (const m of meshesRef.current) {
        const mat = m.material;
        if (!Array.isArray(mat)) mat.color.setHex(colorToHex(color));
      }
    }
  }, [materialSlots, color, isMultiColor]);
  const containerStyle = {
    width: "100%",
    height: "100%",
    borderRadius: 8,
    border: `1px solid ${theme.border}`,
    overflow: "hidden",
    position: "relative",
    ...style
  };
  const overlayStyle = {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
    background: "rgba(15,23,42,0.5)"
  };
  const showLoading = loading || !model && !error && geometries.length === 0;
  return /* @__PURE__ */ jsxs("div", { ref: containerRef, className, style: containerStyle, children: [
    showLoading && /* @__PURE__ */ jsx("div", { style: overlayStyle, children: /* @__PURE__ */ jsx(
      "div",
      {
        style: {
          width: "100%",
          height: "100%",
          background: theme.surface,
          animation: "pulse 2s ease-in-out infinite",
          borderRadius: 8
        }
      }
    ) }),
    error && /* @__PURE__ */ jsx("div", { style: overlayStyle, children: /* @__PURE__ */ jsxs("div", { style: { textAlign: "center", padding: 32 }, children: [
      /* @__PURE__ */ jsx("p", { style: { color: "#ef4444", marginBottom: 8 }, children: "Failed to render model" }),
      /* @__PURE__ */ jsx("p", { style: { fontSize: 12, color: theme.textMuted }, children: error.message })
    ] }) }),
    showDebugOverlay && isMultiColor && materialSlots.length > 1 && /* @__PURE__ */ jsxs(
      "div",
      {
        style: {
          position: "absolute",
          top: 8,
          left: 8,
          zIndex: 20,
          background: "rgba(0,0,0,0.7)",
          borderRadius: 6,
          padding: "4px 8px",
          fontSize: 11,
          fontFamily: theme.fontFamily,
          color: "#4ade80",
          pointerEvents: "none",
          maxWidth: 200
        },
        children: [
          /* @__PURE__ */ jsxs("div", { children: [
            "\u{1F3A8} ",
            materialSlots.length,
            " colors"
          ] }),
          /* @__PURE__ */ jsx("div", { style: { display: "flex", gap: 3, marginTop: 4, flexWrap: "wrap" }, children: materialSlots.map((s, i) => /* @__PURE__ */ jsx(
            "div",
            {
              style: {
                width: 12,
                height: 12,
                borderRadius: 2,
                border: "1px solid rgba(255,255,255,0.3)",
                backgroundColor: s.selectedColor.startsWith("#") ? s.selectedColor : void 0
              },
              title: `${s.name}: ${s.selectedColor}`
            },
            i
          )) }),
          debugInfo && /* @__PURE__ */ jsx("div", { style: { marginTop: 4, fontSize: 9, color: "rgba(74,222,128,0.6)", whiteSpace: "pre-wrap" }, children: debugInfo })
        ]
      }
    )
  ] });
}
function ColorPicker({ colorOptions, theme: themeOverrides, className, style }) {
  const { isMultiColor, materialSlots, setSlotColor } = useThreeMF();
  const theme = resolveTheme(themeOverrides);
  const colors = colorOptions ?? DEFAULT_COLOR_OPTIONS;
  if (!isMultiColor || materialSlots.length === 0) return null;
  const rootStyle = {
    background: `${theme.surface}33`,
    borderRadius: 8,
    padding: 12,
    border: `1px solid ${theme.border}`,
    fontFamily: theme.fontFamily,
    ...style
  };
  return /* @__PURE__ */ jsxs("div", { className, style: rootStyle, children: [
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }, children: [
      /* @__PURE__ */ jsx("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: theme.accent, strokeWidth: 2, children: /* @__PURE__ */ jsx(
        "path",
        {
          strokeLinecap: "round",
          strokeLinejoin: "round",
          d: "M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
        }
      ) }),
      /* @__PURE__ */ jsx("span", { style: { fontSize: 12, fontWeight: 500, color: theme.textMuted }, children: "Multi-color" })
    ] }),
    /* @__PURE__ */ jsxs("p", { style: { fontSize: 11, color: theme.textMuted, marginBottom: 12 }, children: [
      materialSlots.length,
      " filament",
      materialSlots.length !== 1 ? "s" : "",
      " \u2014 select colors:"
    ] }),
    /* @__PURE__ */ jsx("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: materialSlots.map((slot, index) => {
      const isHexColor = slot.selectedColor.startsWith("#");
      const originalColorHex = slot.id.startsWith("#") ? slot.id : null;
      return /* @__PURE__ */ jsxs(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 8px",
            borderRadius: 6,
            background: `${theme.surface}80`,
            border: `1px solid ${theme.surface}`
          },
          children: [
            originalColorHex && /* @__PURE__ */ jsx(
              "div",
              {
                style: {
                  width: 16,
                  height: 16,
                  borderRadius: 3,
                  border: `1px solid ${theme.textMuted}`,
                  backgroundColor: originalColorHex,
                  flexShrink: 0
                },
                title: `Original: ${originalColorHex}`
              }
            ),
            /* @__PURE__ */ jsx(
              "span",
              {
                style: {
                  fontSize: 11,
                  color: theme.textMuted,
                  flexShrink: 0,
                  width: 80,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                },
                title: slot.name || `Slot ${index + 1}`,
                children: slot.name || `Filament ${index + 1}`
              }
            ),
            /* @__PURE__ */ jsxs("div", { style: { flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }, children: [
              /* @__PURE__ */ jsx(
                "div",
                {
                  style: {
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    border: `1px solid ${theme.surface}`,
                    backgroundColor: colorToCss(slot.selectedColor),
                    flexShrink: 0
                  },
                  title: slot.selectedColor
                }
              ),
              /* @__PURE__ */ jsxs(
                "select",
                {
                  value: slot.selectedColor,
                  onChange: (e) => setSlotColor(slot.id, e.target.value),
                  style: {
                    flex: 1,
                    minWidth: 0,
                    padding: "6px 8px",
                    fontSize: 11,
                    borderRadius: 4,
                    background: theme.background,
                    border: `1px solid ${theme.surface}`,
                    color: theme.text,
                    outline: "none",
                    cursor: "pointer"
                  },
                  children: [
                    isHexColor && /* @__PURE__ */ jsxs("option", { value: slot.selectedColor, children: [
                      "Original (",
                      slot.selectedColor,
                      ")"
                    ] }),
                    colors.map((c) => /* @__PURE__ */ jsx("option", { value: c.name, children: c.name }, c.name))
                  ]
                }
              )
            ] })
          ]
        },
        slot.id
      );
    }) })
  ] });
}
function PlateSelector({ theme: themeOverrides, className, style }) {
  const { plates, selectedPlateId, selectPlate } = useThreeMF();
  const theme = resolveTheme(themeOverrides);
  if (!plates || plates.length <= 1) return null;
  return /* @__PURE__ */ jsxs("div", { className, style: { fontFamily: theme.fontFamily, ...style }, children: [
    /* @__PURE__ */ jsx(
      "label",
      {
        style: {
          display: "block",
          fontSize: 12,
          fontWeight: 500,
          color: theme.textMuted,
          marginBottom: 8
        },
        children: "Plate"
      }
    ),
    /* @__PURE__ */ jsx(
      "select",
      {
        value: selectedPlateId ?? "",
        onChange: (e) => selectPlate(e.target.value ? parseInt(e.target.value) : null),
        style: {
          width: "100%",
          padding: "10px 12px",
          borderRadius: 8,
          background: theme.background,
          border: `1px solid ${theme.border}`,
          color: theme.text,
          fontSize: 13,
          outline: "none",
          cursor: "pointer"
        },
        children: plates.map((plate) => /* @__PURE__ */ jsxs("option", { value: plate.id, children: [
          plate.name,
          " (",
          plate.objectIds.length,
          " object",
          plate.objectIds.length !== 1 ? "s" : "",
          ")"
        ] }, plate.id))
      }
    ),
    selectedPlateId && /* @__PURE__ */ jsxs("p", { style: { fontSize: 11, color: theme.textMuted, marginTop: 8 }, children: [
      "Showing objects from ",
      plates.find((p) => p.id === selectedPlateId)?.name
    ] })
  ] });
}
function WorkbenchInner({
  file,
  colorOptions,
  theme: themeOverrides,
  className,
  style
}) {
  const { loadFile, model } = useThreeMF();
  const theme = resolveTheme(themeOverrides);
  const prevFileRef = useRef(null);
  useEffect(() => {
    if (file && file !== prevFileRef.current) {
      prevFileRef.current = file;
      loadFile(file);
    }
  }, [file, loadFile]);
  const rootStyle = {
    display: "flex",
    gap: 16,
    width: "100%",
    height: "100%",
    fontFamily: theme.fontFamily,
    ...style
  };
  return /* @__PURE__ */ jsxs("div", { className, style: rootStyle, children: [
    /* @__PURE__ */ jsx("div", { style: { flex: 1, minHeight: 300 }, children: /* @__PURE__ */ jsx(Viewer, { theme: themeOverrides, showDebugOverlay: true }) }),
    model && /* @__PURE__ */ jsxs(
      "div",
      {
        style: {
          width: 260,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          flexShrink: 0
        },
        children: [
          /* @__PURE__ */ jsx(PlateSelector, { theme: themeOverrides }),
          /* @__PURE__ */ jsx(ColorPicker, { theme: themeOverrides, colorOptions })
        ]
      }
    )
  ] });
}
function ThreeMFWorkbench(props) {
  return /* @__PURE__ */ jsx(
    ThreeMFProvider,
    {
      onParsed: props.onParsed,
      onError: props.onError,
      onSlotColorChange: props.onSlotColorChange,
      onPlateChange: props.onPlateChange,
      children: /* @__PURE__ */ jsx(WorkbenchInner, { ...props })
    }
  );
}

export { ColorPicker, DEFAULT_COLOR_OPTIONS, DEFAULT_THEME, PlateSelector, ThreeMFParseError, ThreeMFProvider, ThreeMFWorkbench, Viewer, calculateBoundingBox, calculateVolume, colorToCss, colorToHex, parse3MF, resolveTheme, useThreeMF };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map