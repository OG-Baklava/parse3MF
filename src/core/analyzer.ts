import { BufferGeometry, Vector3 } from 'three'
import type { BoundingBox } from './types'

/**
 * Calculate volume of a BufferGeometry using the signed-tetrahedron method.
 * @returns Volume in cm³ (assumes model units are mm).
 */
export function calculateVolume(geometry: BufferGeometry): number {
  const position = geometry.attributes.position
  if (!position) throw new Error('Geometry has no position attribute')

  let volume = 0
  const index = geometry.index

  if (index) {
    const arr = index.array as Uint32Array | Uint16Array
    for (let i = 0; i < index.count; i += 3) {
      volume += signedVolumeOfTriangle(
        new Vector3(position.getX(arr[i]), position.getY(arr[i]), position.getZ(arr[i])),
        new Vector3(position.getX(arr[i + 1]), position.getY(arr[i + 1]), position.getZ(arr[i + 1])),
        new Vector3(position.getX(arr[i + 2]), position.getY(arr[i + 2]), position.getZ(arr[i + 2])),
      )
    }
  } else {
    for (let i = 0; i < position.count; i += 3) {
      volume += signedVolumeOfTriangle(
        new Vector3(position.getX(i), position.getY(i), position.getZ(i)),
        new Vector3(position.getX(i + 1), position.getY(i + 1), position.getZ(i + 1)),
        new Vector3(position.getX(i + 2), position.getY(i + 2), position.getZ(i + 2)),
      )
    }
  }

  // mm³ → cm³
  return Math.abs(volume) / 1000
}

function signedVolumeOfTriangle(p1: Vector3, p2: Vector3, p3: Vector3): number {
  return p1.dot(p2.cross(p3)) / 6.0
}

/**
 * Calculate bounding-box dimensions.
 * @returns { x, y, z } in mm.
 */
export function calculateBoundingBox(geometry: BufferGeometry): BoundingBox {
  geometry.computeBoundingBox()
  const box = geometry.boundingBox
  if (!box) throw new Error('Failed to compute bounding box')
  const size = new Vector3()
  box.getSize(size)
  return {
    x: Number(size.x.toFixed(2)),
    y: Number(size.y.toFixed(2)),
    z: Number(size.z.toFixed(2)),
  }
}
