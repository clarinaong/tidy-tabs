export type IconAppearance = 'light' | 'normal' | 'empty';

// Weight visible pixels by opacity so transparent padding does not affect contrast.
export function classifyIconPixels(pixels: Uint8ClampedArray): IconAppearance {
  let visible = 0;
  let light = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const opacity = pixels[i + 3]! / 255;
    visible += opacity;
    const luminance = (0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!) / 255;
    if (luminance >= 0.8) light += opacity;
  }
  if (visible === 0) return 'empty';
  return light / visible >= 0.85 ? 'light' : 'normal';
}

export function iconAppearance(image: HTMLImageElement): IconAppearance {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return 'normal';
    context.drawImage(image, 0, 0, 32, 32);
    return classifyIconPixels(context.getImageData(0, 0, 32, 32).data);
  } catch {
    // If pixel inspection is unavailable, retain the original icon.
    return 'normal';
  }
}
