export const manifestArtifactPathLimit=32767;

export function validManifestArtifactPath(value:unknown):value is string{
 return typeof value==='string'&&value.length<=manifestArtifactPathLimit&&!/[\r\n\u0000]/.test(value);
}
