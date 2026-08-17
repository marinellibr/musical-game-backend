const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateRoomCode(len = 4) {
  let code = "";
  for (let i = 0; i < len; i++)
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return code;
}
