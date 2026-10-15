export const toLatinDigits = (text) =>
  text.replace(/[٠-٩۰-۹]/g, (digit) =>
    String(digit.charCodeAt(0) - (digit <= "٩" ? 0x0660 : 0x06f0)),
  );
