declare module 'bs58' {
  const codec: { encode(bytes: Uint8Array): string; decode(text: string): Uint8Array };
  export default codec;
}
