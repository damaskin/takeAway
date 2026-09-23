import { sniffImageType } from './uploaded-image.decorator';

describe('sniffImageType', () => {
  it('recognises the raster formats we store by their magic numbers', () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffImageType(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'binary'))).toBe('image/webp');
    expect(sniffImageType(Buffer.from('\u0000\u0000\u0000\u001cftypavif', 'binary'))).toBe('image/avif');
  });

  it('refuses SVG and anything else, whatever name or type the client claims', () => {
    expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
    expect(sniffImageType(Buffer.from('GIF89a'))).toBeNull();
    expect(sniffImageType(Buffer.from([]))).toBeNull();
  });
});
