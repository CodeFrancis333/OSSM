import * as THREE from 'three'

export default function computeLCS(p1, p2, betaDeg=0){
  const x = new THREE.Vector3().subVectors(p2, p1).normalize()
  const up = new THREE.Vector3(0,1,0)

  let y = new THREE.Vector3().crossVectors(up, x).normalize()
  // if parallel, pick arbitrary perpendicular
  if (y.lengthSq() < 1e-8) {
    y = new THREE.Vector3().crossVectors(new THREE.Vector3(1,0,0), x).normalize()
  }
  let z = new THREE.Vector3().crossVectors(x, y).normalize()

  // apply beta rotation about local x-axis
  if (betaDeg !== 0){
    const beta = THREE.MathUtils.degToRad(betaDeg)
    const cos = Math.cos(beta), sin = Math.sin(beta)
    const yRot = y.clone().multiplyScalar(cos).add(z.clone().multiplyScalar(sin))
    const zRot = z.clone().multiplyScalar(cos).sub(y.clone().multiplyScalar(sin))
    y = yRot.normalize()
    z = zRot.normalize()
  }

  return { x, y, z }
}
