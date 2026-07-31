import * as THREE from 'three';

/**
 * Releases every GPU resource reachable from `root`.
 *
 * Three.js does not reference-count: dropping a scene graph leaks its buffers
 * and textures until the context is destroyed. Anything built at runtime has to
 * be walked and disposed explicitly.
 */
export function disposeObject(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();

  root.traverse((obj) => {
    const withGeometry = obj as Partial<THREE.Mesh>;
    if (withGeometry.geometry) geometries.add(withGeometry.geometry);

    const withMaterial = obj as Partial<THREE.Mesh>;
    if (withMaterial.material) {
      const list = Array.isArray(withMaterial.material)
        ? withMaterial.material
        : [withMaterial.material];
      for (const mat of list) materials.add(mat);
    }
  });

  // Collect textures from every material slot before disposing the materials.
  for (const mat of materials) {
    for (const value of Object.values(mat as unknown as Record<string, unknown>)) {
      if (value instanceof THREE.Texture) textures.add(value);
    }
  }

  for (const geo of geometries) geo.dispose();
  for (const mat of materials) mat.dispose();
  for (const tex of textures) tex.dispose();

  root.removeFromParent();
}
