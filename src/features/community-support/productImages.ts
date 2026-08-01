export const MAX_PRODUCT_IMAGES = 4;
export const MAX_PRODUCT_IMAGE_SOURCE_BYTES = 12 * 1024 * 1024;
export const MAX_PRODUCT_IMAGE_DATA_URL_LENGTH = 300_000;

const SUPPORTED_PRODUCT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const loadImage = (file: File) => new Promise<HTMLImageElement>((resolve, reject) => {
  const objectUrl = URL.createObjectURL(file);
  const image = new window.Image();
  image.onload = () => {
    URL.revokeObjectURL(objectUrl);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    reject(new Error("image-decode-failed"));
  };
  image.src = objectUrl;
});

const renderImage = (image: HTMLImageElement, maxDimension: number, quality: number) => {
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("image-canvas-unavailable");
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/webp", quality);
};

export const prepareProductImage = async (file: File): Promise<string> => {
  if (!SUPPORTED_PRODUCT_IMAGE_TYPES.has(file.type)) throw new Error("unsupported-image-type");
  if (file.size <= 0 || file.size > MAX_PRODUCT_IMAGE_SOURCE_BYTES) throw new Error("image-too-large");

  const image = await loadImage(file);
  for (const [maxDimension, quality] of [[1200, 0.78], [900, 0.68], [700, 0.58]] as const) {
    const dataUrl = renderImage(image, maxDimension, quality);
    if (dataUrl.length <= MAX_PRODUCT_IMAGE_DATA_URL_LENGTH) return dataUrl;
  }
  throw new Error("compressed-image-too-large");
};
