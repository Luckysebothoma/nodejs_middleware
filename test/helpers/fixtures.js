// Tiny byte fixtures (only the headers matter: type is detected from content).
const pad = (arr, n = 64) => Buffer.concat([Buffer.from(arr), Buffer.alloc(Math.max(0, n - arr.length), 1)]);
export const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const PNG2 = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9], 80);
export const JPEG = pad([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
export const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([40, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(40, 2)]);
export const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40, 3)]);
export const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
export const TEXT_AS_PNG = Buffer.from('this is definitely not a png file, just text pretending');
