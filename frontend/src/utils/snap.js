import * as THREE from 'three'

export default function snapToGrid(vec3, gridSize){
  const v = vec3.clone()
  v.x = Math.round(v.x / gridSize) * gridSize
  v.y = Math.round(v.y / gridSize) * gridSize
  v.z = Math.round(v.z / gridSize) * gridSize
  return v
}
