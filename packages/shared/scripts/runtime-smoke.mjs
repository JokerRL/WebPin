const mod = await import("../dist/index.js");

const requiredExports = ["annotationSchema", "boundingBoxSchema", "taskPackageSchema", "createTaskPackage"];

for (const exportName of requiredExports) {
  if (!(exportName in mod)) {
    throw new Error(`Missing runtime export: ${exportName}`);
  }
}
