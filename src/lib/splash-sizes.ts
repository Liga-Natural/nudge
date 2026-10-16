// iPhone launch images (see scripts/make-splash.mjs, which draws them into public/splash).
// [CSS width, CSS height, pixel ratio]. Keep in step with the script.
export const SPLASH_SIZES: [number, number, number][] = [
  [440, 956, 3], // 16 Pro Max
  [402, 874, 3], // 16 Pro
  [430, 932, 3], // 16 Plus, 15 Pro Max, 15 Plus, 14 Pro Max
  [393, 852, 3], // 16, 15 Pro, 15, 14 Pro
  [428, 926, 3], // 14 Plus, 13 Pro Max, 12 Pro Max
  [390, 844, 3], // 14, 13, 13 Pro, 12, 12 Pro
  [375, 812, 3], // 13 mini, 12 mini, 11 Pro, XS, X
  [414, 896, 3], // 11 Pro Max, XS Max
  [414, 896, 2], // 11, XR
  [414, 736, 3], // 8 Plus, 7 Plus, 6s Plus
  [375, 667, 2], // 8, 7, 6s, SE (2nd and 3rd gen)
  [320, 568, 2], // SE (1st gen), 5s
];

export const BACKGROUND = { light: "#FAF8F5", dark: "#15120F" } as const;

export function startupImages() {
  return SPLASH_SIZES.flatMap(([w, h, r]) =>
    (["light", "dark"] as const).map((scheme) => ({
      url: `/splash/${w}x${h}@${r}x-${scheme}.png`,
      media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait) and (prefers-color-scheme: ${scheme})`,
    })),
  );
}
