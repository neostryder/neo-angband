/** The browser and desktop apply the same backup names and storage ceilings. */
export const BACKUP_LIMITS = Object.freeze({ files: 200, fileBytes: 8 * 1024 * 1024, totalBytes: 256 * 1024 * 1024 });

export function isHostFolderFileName(name: unknown, ext: string): name is string {
  return (
    /^\.[a-z0-9]{1,16}$/u.test(ext) &&
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= 255 &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes(":") &&
    !name.includes("..") &&
    !/[<>"|?*]/u.test(name) &&
    ![...name].some((char) => char.charCodeAt(0) < 32) &&
    !/^(con|prn|aux|nul|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])[ .]*(\.|$)/iu.test(name) &&
    !name.endsWith(" ") &&
    !name.endsWith(".") &&
    !name.startsWith(".") &&
    !name.includes("\0") &&
    name.endsWith(ext)
  );
}
