// deno:https://jsr.io/@std/internal/1.0.14/_os.ts
function checkWindows() {
  const global = globalThis;
  const platform = global.process?.platform;
  if (typeof platform === "string") return platform.startsWith("win");
  const os = global.Deno?.build?.os;
  if (typeof os === "string") return os === "windows";
  return global.navigator?.platform?.startsWith("Win") ?? false;
}

// deno:https://jsr.io/@std/internal/1.0.14/os.ts
var isWindows = checkWindows();

// deno:https://jsr.io/@std/path/1.1.6/_common/assert_path.ts
function assertPath(path) {
  if (typeof path !== "string") {
    throw new TypeError(`Path must be a string, received "${JSON.stringify(path)}"`);
  }
}

// deno:https://jsr.io/@std/path/1.1.6/_common/basename.ts
function stripSuffix(name, suffix) {
  if (suffix.length >= name.length) {
    return name;
  }
  const lenDiff = name.length - suffix.length;
  for (let i = suffix.length - 1; i >= 0; --i) {
    if (name.charCodeAt(lenDiff + i) !== suffix.charCodeAt(i)) {
      return name;
    }
  }
  return name.slice(0, -suffix.length);
}
function lastPathSegment(path, isSep, start = 0) {
  let matchedNonSeparator = false;
  let end = path.length;
  for (let i = path.length - 1; i >= start; --i) {
    if (isSep(path.charCodeAt(i))) {
      if (matchedNonSeparator) {
        start = i + 1;
        break;
      }
    } else if (!matchedNonSeparator) {
      matchedNonSeparator = true;
      end = i + 1;
    }
  }
  return path.slice(start, end);
}
function assertArgs(path, suffix) {
  assertPath(path);
  if (path.length === 0) return path;
  if (typeof suffix !== "string") {
    throw new TypeError(`Suffix must be a string, received "${JSON.stringify(suffix)}"`);
  }
}

// deno:https://jsr.io/@std/path/1.1.6/_common/from_file_url.ts
function assertArg(url) {
  url = url instanceof URL ? url : new URL(url);
  if (url.protocol !== "file:") {
    throw new TypeError(`URL must be a file URL: received "${url.protocol}"`);
  }
  return url;
}

// deno:https://jsr.io/@std/path/1.1.6/posix/from_file_url.ts
function fromFileUrl(url) {
  url = assertArg(url);
  return decodeURIComponent(url.pathname.replace(/%(?![0-9A-Fa-f]{2})/g, "%25"));
}

// deno:https://jsr.io/@std/path/1.1.6/_common/strip_trailing_separators.ts
function stripTrailingSeparators(segment, isSep) {
  if (segment.length <= 1) {
    return segment;
  }
  let end = segment.length;
  for (let i = segment.length - 1; i > 0; i--) {
    if (isSep(segment.charCodeAt(i))) {
      end = i;
    } else {
      break;
    }
  }
  return segment.slice(0, end);
}

// deno:https://jsr.io/@std/path/1.1.6/_common/constants.ts
var CHAR_UPPERCASE_A = 65;
var CHAR_LOWERCASE_A = 97;
var CHAR_UPPERCASE_Z = 90;
var CHAR_LOWERCASE_Z = 122;
var CHAR_DOT = 46;
var CHAR_FORWARD_SLASH = 47;
var CHAR_BACKWARD_SLASH = 92;
var CHAR_COLON = 58;

// deno:https://jsr.io/@std/path/1.1.6/posix/_util.ts
function isPosixPathSeparator(code) {
  return code === CHAR_FORWARD_SLASH;
}

// deno:https://jsr.io/@std/path/1.1.6/posix/basename.ts
function basename(path, suffix = "") {
  if (path instanceof URL) {
    path = fromFileUrl(path);
  }
  assertArgs(path, suffix);
  const lastSegment = lastPathSegment(path, isPosixPathSeparator);
  const strippedSegment = stripTrailingSeparators(lastSegment, isPosixPathSeparator);
  return suffix ? stripSuffix(strippedSegment, suffix) : strippedSegment;
}

// deno:https://jsr.io/@std/path/1.1.6/windows/_util.ts
function isPosixPathSeparator2(code) {
  return code === CHAR_FORWARD_SLASH;
}
function isPathSeparator(code) {
  return code === CHAR_FORWARD_SLASH || code === CHAR_BACKWARD_SLASH;
}
function isWindowsDeviceRoot(code) {
  return code >= CHAR_LOWERCASE_A && code <= CHAR_LOWERCASE_Z || code >= CHAR_UPPERCASE_A && code <= CHAR_UPPERCASE_Z;
}

// deno:https://jsr.io/@std/path/1.1.6/windows/from_file_url.ts
function fromFileUrl2(url) {
  url = assertArg(url);
  let path = decodeURIComponent(url.pathname.replace(/\//g, "\\").replace(/%(?![0-9A-Fa-f]{2})/g, "%25")).replace(/^\\*([A-Za-z]:)(\\|$)/, "$1\\");
  if (url.hostname !== "") {
    path = `\\\\${url.hostname}${path}`;
  }
  return path;
}

// deno:https://jsr.io/@std/path/1.1.6/windows/basename.ts
function basename2(path, suffix = "") {
  if (path instanceof URL) {
    path = fromFileUrl2(path);
  }
  assertArgs(path, suffix);
  let start = 0;
  if (path.length >= 2) {
    const drive = path.charCodeAt(0);
    if (isWindowsDeviceRoot(drive)) {
      if (path.charCodeAt(1) === CHAR_COLON) start = 2;
    }
  }
  const lastSegment = lastPathSegment(path, isPathSeparator, start);
  const strippedSegment = stripTrailingSeparators(lastSegment, isPathSeparator);
  return suffix ? stripSuffix(strippedSegment, suffix) : strippedSegment;
}

// deno:https://jsr.io/@std/path/1.1.6/basename.ts
function basename3(path, suffix = "") {
  return isWindows ? basename2(path, suffix) : basename(path, suffix);
}

// deno:https://jsr.io/@std/path/1.1.6/_common/dirname.ts
function assertArg2(path) {
  assertPath(path);
  if (path.length === 0) return ".";
}

// deno:https://jsr.io/@std/path/1.1.6/posix/dirname.ts
function dirname(path) {
  if (path instanceof URL) {
    path = fromFileUrl(path);
  }
  assertArg2(path);
  let end = -1;
  let matchedNonSeparator = false;
  for (let i = path.length - 1; i >= 1; --i) {
    if (isPosixPathSeparator(path.charCodeAt(i))) {
      if (matchedNonSeparator) {
        end = i;
        break;
      }
    } else {
      matchedNonSeparator = true;
    }
  }
  if (end === -1) {
    return isPosixPathSeparator(path.charCodeAt(0)) ? "/" : ".";
  }
  return stripTrailingSeparators(path.slice(0, end), isPosixPathSeparator);
}

// deno:https://jsr.io/@std/path/1.1.6/windows/dirname.ts
function dirname2(path) {
  if (path instanceof URL) {
    path = fromFileUrl2(path);
  }
  assertArg2(path);
  const len = path.length;
  let rootEnd = -1;
  let end = -1;
  let matchedSlash = true;
  let offset = 0;
  const code = path.charCodeAt(0);
  if (len > 1) {
    if (isPathSeparator(code)) {
      rootEnd = offset = 1;
      if (isPathSeparator(path.charCodeAt(1))) {
        let j = 2;
        let last = j;
        for (; j < len; ++j) {
          if (isPathSeparator(path.charCodeAt(j))) break;
        }
        if (j < len && j !== last) {
          last = j;
          for (; j < len; ++j) {
            if (!isPathSeparator(path.charCodeAt(j))) break;
          }
          if (j < len && j !== last) {
            last = j;
            for (; j < len; ++j) {
              if (isPathSeparator(path.charCodeAt(j))) break;
            }
            if (j === len) {
              return path;
            }
            if (j !== last) {
              rootEnd = offset = j + 1;
            }
          }
        }
      }
    } else if (isWindowsDeviceRoot(code)) {
      if (path.charCodeAt(1) === CHAR_COLON) {
        rootEnd = offset = 2;
        if (len > 2) {
          if (isPathSeparator(path.charCodeAt(2))) rootEnd = offset = 3;
        }
      }
    }
  } else if (isPathSeparator(code)) {
    return path;
  }
  for (let i = len - 1; i >= offset; --i) {
    if (isPathSeparator(path.charCodeAt(i))) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }
  if (end === -1) {
    if (rootEnd === -1) return ".";
    else end = rootEnd;
  }
  return stripTrailingSeparators(path.slice(0, end), isPosixPathSeparator2);
}

// deno:https://jsr.io/@std/path/1.1.6/dirname.ts
function dirname3(path) {
  return isWindows ? dirname2(path) : dirname(path);
}

// deno:https://jsr.io/@std/path/1.1.6/posix/extname.ts
function extname(path) {
  if (path instanceof URL) {
    path = fromFileUrl(path);
  }
  assertPath(path);
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  let preDotState = 0;
  for (let i = path.length - 1; i >= 0; --i) {
    const code = path.charCodeAt(i);
    if (isPosixPathSeparator(code)) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
    if (code === CHAR_DOT) {
      if (startDot === -1) startDot = i;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }
  if (startDot === -1 || end === -1 || // We saw a non-dot character immediately before the dot
  preDotState === 0 || // The (right-most) trimmed path component is exactly '..'
  preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
    return "";
  }
  return path.slice(startDot, end);
}

// deno:https://jsr.io/@std/path/1.1.6/windows/extname.ts
function extname2(path) {
  if (path instanceof URL) {
    path = fromFileUrl2(path);
  }
  assertPath(path);
  let start = 0;
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  let preDotState = 0;
  if (path.length >= 2 && path.charCodeAt(1) === CHAR_COLON && isWindowsDeviceRoot(path.charCodeAt(0))) {
    start = startPart = 2;
  }
  for (let i = path.length - 1; i >= start; --i) {
    const code = path.charCodeAt(i);
    if (isPathSeparator(code)) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
    if (code === CHAR_DOT) {
      if (startDot === -1) startDot = i;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }
  if (startDot === -1 || end === -1 || // We saw a non-dot character immediately before the dot
  preDotState === 0 || // The (right-most) trimmed path component is exactly '..'
  preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
    return "";
  }
  return path.slice(startDot, end);
}

// deno:https://jsr.io/@std/path/1.1.6/extname.ts
function extname3(path) {
  return isWindows ? extname2(path) : extname(path);
}

// deno:https://jsr.io/@std/path/1.1.6/from_file_url.ts
function fromFileUrl3(url) {
  return isWindows ? fromFileUrl2(url) : fromFileUrl(url);
}

// deno:https://jsr.io/@std/path/1.1.6/posix/is_absolute.ts
function isAbsolute(path) {
  assertPath(path);
  return path.length > 0 && isPosixPathSeparator(path.charCodeAt(0));
}

// deno:https://jsr.io/@std/path/1.1.6/windows/is_absolute.ts
function isAbsolute2(path) {
  assertPath(path);
  const len = path.length;
  if (len === 0) return false;
  const code = path.charCodeAt(0);
  if (isPathSeparator(code)) {
    return true;
  } else if (isWindowsDeviceRoot(code)) {
    if (len > 2 && path.charCodeAt(1) === CHAR_COLON) {
      if (isPathSeparator(path.charCodeAt(2))) return true;
    }
  }
  return false;
}

// deno:https://jsr.io/@std/path/1.1.6/is_absolute.ts
function isAbsolute3(path) {
  return isWindows ? isAbsolute2(path) : isAbsolute(path);
}

// deno:https://jsr.io/@std/path/1.1.6/_common/normalize.ts
function assertArg4(path) {
  assertPath(path);
  if (path.length === 0) return ".";
}

// deno:https://jsr.io/@std/path/1.1.6/_common/normalize_string.ts
function normalizeString(path, allowAboveRoot, separator, isPathSeparator2) {
  let res = "";
  let lastSegmentLength = 0;
  let lastSlash = -1;
  let dots = 0;
  let code;
  for (let i = 0; i <= path.length; ++i) {
    if (i < path.length) code = path.charCodeAt(i);
    else if (isPathSeparator2(code)) break;
    else code = CHAR_FORWARD_SLASH;
    if (isPathSeparator2(code)) {
      if (lastSlash === i - 1 || dots === 1) {
      } else if (lastSlash !== i - 1 && dots === 2) {
        if (res.length < 2 || lastSegmentLength !== 2 || res.charCodeAt(res.length - 1) !== CHAR_DOT || res.charCodeAt(res.length - 2) !== CHAR_DOT) {
          if (res.length > 2) {
            const lastSlashIndex = res.lastIndexOf(separator);
            if (lastSlashIndex === -1) {
              res = "";
              lastSegmentLength = 0;
            } else {
              res = res.slice(0, lastSlashIndex);
              lastSegmentLength = res.length - 1 - res.lastIndexOf(separator);
            }
            lastSlash = i;
            dots = 0;
            continue;
          } else if (res.length === 2 || res.length === 1) {
            res = "";
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          if (res.length > 0) res += `${separator}..`;
          else res = "..";
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0) res += separator + path.slice(lastSlash + 1, i);
        else res = path.slice(lastSlash + 1, i);
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === CHAR_DOT && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}

// deno:https://jsr.io/@std/path/1.1.6/posix/normalize.ts
function normalize(path) {
  if (path instanceof URL) {
    path = fromFileUrl(path);
  }
  assertArg4(path);
  const isAbsolute4 = isPosixPathSeparator(path.charCodeAt(0));
  const trailingSeparator = isPosixPathSeparator(path.charCodeAt(path.length - 1));
  path = normalizeString(path, !isAbsolute4, "/", isPosixPathSeparator);
  if (path.length === 0 && !isAbsolute4) path = ".";
  if (path.length > 0 && trailingSeparator) path += "/";
  if (isAbsolute4) return `/${path}`;
  return path;
}

// deno:https://jsr.io/@std/path/1.1.6/posix/join.ts
function join(path, ...paths) {
  if (path === void 0) return ".";
  if (path instanceof URL) {
    path = fromFileUrl(path);
  }
  paths = path ? [
    path,
    ...paths
  ] : paths;
  paths.forEach((path2) => assertPath(path2));
  const joined = paths.filter((path2) => path2.length > 0).join("/");
  return joined === "" ? "." : normalize(joined);
}

// deno:https://jsr.io/@std/path/1.1.6/windows/normalize.ts
function normalize2(path) {
  if (path instanceof URL) {
    path = fromFileUrl2(path);
  }
  assertArg4(path);
  const len = path.length;
  let rootEnd = 0;
  let device;
  let isAbsolute4 = false;
  const code = path.charCodeAt(0);
  if (len > 1) {
    if (isPathSeparator(code)) {
      isAbsolute4 = true;
      if (isPathSeparator(path.charCodeAt(1))) {
        let j = 2;
        let last = j;
        for (; j < len; ++j) {
          if (isPathSeparator(path.charCodeAt(j))) break;
        }
        if (j < len && j !== last) {
          const firstPart = path.slice(last, j);
          last = j;
          for (; j < len; ++j) {
            if (!isPathSeparator(path.charCodeAt(j))) break;
          }
          if (j < len && j !== last) {
            last = j;
            for (; j < len; ++j) {
              if (isPathSeparator(path.charCodeAt(j))) break;
            }
            if (j === len) {
              return `\\\\${firstPart}\\${path.slice(last)}\\`;
            } else if (j !== last) {
              device = `\\\\${firstPart}\\${path.slice(last, j)}`;
              rootEnd = j;
            }
          }
        }
      } else {
        rootEnd = 1;
      }
    } else if (isWindowsDeviceRoot(code)) {
      if (path.charCodeAt(1) === CHAR_COLON) {
        device = path.slice(0, 2);
        rootEnd = 2;
        if (len > 2) {
          if (isPathSeparator(path.charCodeAt(2))) {
            isAbsolute4 = true;
            rootEnd = 3;
          }
        }
      }
    }
  } else if (isPathSeparator(code)) {
    return "\\";
  }
  let tail;
  if (rootEnd < len) {
    tail = normalizeString(path.slice(rootEnd), !isAbsolute4, "\\", isPathSeparator);
  } else {
    tail = "";
  }
  if (tail.length === 0 && !isAbsolute4) tail = ".";
  if (tail.length > 0 && isPathSeparator(path.charCodeAt(len - 1))) {
    tail += "\\";
  }
  if (device === void 0) {
    if (isAbsolute4) {
      if (tail.length > 0) return `\\${tail}`;
      else return "\\";
    }
    return tail;
  } else if (isAbsolute4) {
    if (tail.length > 0) return `${device}\\${tail}`;
    else return `${device}\\`;
  }
  return device + tail;
}

// deno:https://jsr.io/@std/path/1.1.6/windows/join.ts
function join2(path, ...paths) {
  if (path instanceof URL) {
    path = fromFileUrl2(path);
  }
  paths = path ? [
    path,
    ...paths
  ] : paths;
  paths.forEach((path2) => assertPath(path2));
  paths = paths.filter((path2) => path2.length > 0);
  if (paths.length === 0) return ".";
  let needsReplace = true;
  let slashCount = 0;
  const firstPart = paths[0];
  if (isPathSeparator(firstPart.charCodeAt(0))) {
    ++slashCount;
    const firstLen = firstPart.length;
    if (firstLen > 1) {
      if (isPathSeparator(firstPart.charCodeAt(1))) {
        ++slashCount;
        if (firstLen > 2) {
          if (isPathSeparator(firstPart.charCodeAt(2))) ++slashCount;
          else {
            needsReplace = false;
          }
        }
      }
    }
  }
  let joined = paths.join("\\");
  if (needsReplace) {
    for (; slashCount < joined.length; ++slashCount) {
      if (!isPathSeparator(joined.charCodeAt(slashCount))) break;
    }
    if (slashCount >= 2) joined = `\\${joined.slice(slashCount)}`;
  }
  return normalize2(joined);
}

// deno:https://jsr.io/@std/path/1.1.6/join.ts
function join3(path, ...paths) {
  return isWindows ? join2(path, ...paths) : join(path, ...paths);
}

// deno:https://jsr.io/@std/path/1.1.6/_common/env.ts
function cwd(errorMessage) {
  const global = globalThis;
  const getCwd = global.process?.cwd ?? global.Deno?.cwd;
  if (typeof getCwd !== "function") {
    throw new TypeError(errorMessage);
  }
  return getCwd();
}

// deno:https://jsr.io/@std/path/1.1.6/posix/resolve.ts
function resolve(...pathSegments) {
  let resolvedPath = "";
  let resolvedAbsolute = false;
  for (let i = pathSegments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    let path;
    if (i >= 0) path = pathSegments[i];
    else {
      path = cwd("Resolved a relative path without a current working directory (CWD)");
    }
    assertPath(path);
    if (path.length === 0) {
      continue;
    }
    resolvedPath = `${path}/${resolvedPath}`;
    resolvedAbsolute = isPosixPathSeparator(path.charCodeAt(0));
  }
  resolvedPath = normalizeString(resolvedPath, !resolvedAbsolute, "/", isPosixPathSeparator);
  if (resolvedAbsolute) {
    if (resolvedPath.length > 0) return `/${resolvedPath}`;
    else return "/";
  } else if (resolvedPath.length > 0) return resolvedPath;
  else return ".";
}

// deno:https://jsr.io/@std/path/1.1.6/_common/relative.ts
function assertArgs2(from, to) {
  assertPath(from);
  assertPath(to);
  if (from === to) return "";
}

// deno:https://jsr.io/@std/path/1.1.6/posix/relative.ts
function relative(from, to) {
  assertArgs2(from, to);
  from = resolve(from);
  to = resolve(to);
  if (from === to) return "";
  let fromStart = 1;
  const fromEnd = from.length;
  for (; fromStart < fromEnd; ++fromStart) {
    if (!isPosixPathSeparator(from.charCodeAt(fromStart))) break;
  }
  const fromLen = fromEnd - fromStart;
  let toStart = 1;
  const toEnd = to.length;
  for (; toStart < toEnd; ++toStart) {
    if (!isPosixPathSeparator(to.charCodeAt(toStart))) break;
  }
  const toLen = toEnd - toStart;
  const length = fromLen < toLen ? fromLen : toLen;
  let lastCommonSep = -1;
  let i = 0;
  for (; i <= length; ++i) {
    if (i === length) {
      if (toLen > length) {
        if (isPosixPathSeparator(to.charCodeAt(toStart + i))) {
          return to.slice(toStart + i + 1);
        } else if (i === 0) {
          return to.slice(toStart + i);
        }
      } else if (fromLen > length) {
        if (isPosixPathSeparator(from.charCodeAt(fromStart + i))) {
          lastCommonSep = i;
        } else if (i === 0) {
          lastCommonSep = 0;
        }
      }
      break;
    }
    const fromCode = from.charCodeAt(fromStart + i);
    const toCode = to.charCodeAt(toStart + i);
    if (fromCode !== toCode) break;
    else if (isPosixPathSeparator(fromCode)) lastCommonSep = i;
  }
  let out = "";
  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
    if (i === fromEnd || isPosixPathSeparator(from.charCodeAt(i))) {
      if (out.length === 0) out += "..";
      else out += "/..";
    }
  }
  if (out.length > 0) return out + to.slice(toStart + lastCommonSep);
  else {
    toStart += lastCommonSep;
    if (isPosixPathSeparator(to.charCodeAt(toStart))) ++toStart;
    return to.slice(toStart);
  }
}

// deno:https://jsr.io/@std/path/1.1.6/windows/resolve.ts
function resolve2(...pathSegments) {
  let resolvedDevice = "";
  let resolvedTail = "";
  let resolvedAbsolute = false;
  for (let i = pathSegments.length - 1; i >= -1; i--) {
    let path;
    if (i >= 0) {
      path = pathSegments[i];
    } else if (!resolvedDevice) {
      path = cwd("Resolved a drive-letter-less path without a current working directory (CWD)");
    } else {
      path = cwd("Resolved a relative path without a current working directory (CWD)");
      if (path === void 0 || path.slice(0, 3).toLowerCase() !== `${resolvedDevice.toLowerCase()}\\`) {
        path = `${resolvedDevice}\\`;
      }
    }
    assertPath(path);
    const len = path.length;
    if (len === 0) continue;
    let rootEnd = 0;
    let device = "";
    let isAbsolute4 = false;
    const code = path.charCodeAt(0);
    if (len > 1) {
      if (isPathSeparator(code)) {
        isAbsolute4 = true;
        if (isPathSeparator(path.charCodeAt(1))) {
          let j = 2;
          let last = j;
          for (; j < len; ++j) {
            if (isPathSeparator(path.charCodeAt(j))) break;
          }
          if (j < len && j !== last) {
            const firstPart = path.slice(last, j);
            last = j;
            for (; j < len; ++j) {
              if (!isPathSeparator(path.charCodeAt(j))) break;
            }
            if (j < len && j !== last) {
              last = j;
              for (; j < len; ++j) {
                if (isPathSeparator(path.charCodeAt(j))) break;
              }
              if (j === len) {
                device = `\\\\${firstPart}\\${path.slice(last)}`;
                rootEnd = j;
              } else if (j !== last) {
                device = `\\\\${firstPart}\\${path.slice(last, j)}`;
                rootEnd = j;
              }
            }
          }
        } else {
          rootEnd = 1;
        }
      } else if (isWindowsDeviceRoot(code)) {
        if (path.charCodeAt(1) === CHAR_COLON) {
          device = path.slice(0, 2);
          rootEnd = 2;
          if (len > 2) {
            if (isPathSeparator(path.charCodeAt(2))) {
              isAbsolute4 = true;
              rootEnd = 3;
            }
          }
        }
      }
    } else if (isPathSeparator(code)) {
      rootEnd = 1;
      isAbsolute4 = true;
    }
    if (device.length > 0 && resolvedDevice.length > 0 && device.toLowerCase() !== resolvedDevice.toLowerCase()) {
      continue;
    }
    if (resolvedDevice.length === 0 && device.length > 0) {
      resolvedDevice = device;
    }
    if (!resolvedAbsolute) {
      resolvedTail = `${path.slice(rootEnd)}\\${resolvedTail}`;
      resolvedAbsolute = isAbsolute4;
    }
    if (resolvedAbsolute && resolvedDevice.length > 0) break;
  }
  resolvedTail = normalizeString(resolvedTail, !resolvedAbsolute, "\\", isPathSeparator);
  return resolvedDevice + (resolvedAbsolute ? "\\" : "") + resolvedTail || ".";
}

// deno:https://jsr.io/@std/path/1.1.6/windows/relative.ts
function relative2(from, to) {
  assertArgs2(from, to);
  const fromOrig = resolve2(from);
  const toOrig = resolve2(to);
  if (fromOrig === toOrig) return "";
  from = fromOrig.toLowerCase();
  to = toOrig.toLowerCase();
  if (from === to) return "";
  let fromStart = 0;
  let fromEnd = from.length;
  for (; fromStart < fromEnd; ++fromStart) {
    if (from.charCodeAt(fromStart) !== CHAR_BACKWARD_SLASH) break;
  }
  for (; fromEnd - 1 > fromStart; --fromEnd) {
    if (from.charCodeAt(fromEnd - 1) !== CHAR_BACKWARD_SLASH) break;
  }
  const fromLen = fromEnd - fromStart;
  let toStart = 0;
  let toEnd = to.length;
  for (; toStart < toEnd; ++toStart) {
    if (to.charCodeAt(toStart) !== CHAR_BACKWARD_SLASH) break;
  }
  for (; toEnd - 1 > toStart; --toEnd) {
    if (to.charCodeAt(toEnd - 1) !== CHAR_BACKWARD_SLASH) break;
  }
  const toLen = toEnd - toStart;
  const length = fromLen < toLen ? fromLen : toLen;
  let lastCommonSep = -1;
  let i = 0;
  for (; i <= length; ++i) {
    if (i === length) {
      if (toLen > length) {
        if (to.charCodeAt(toStart + i) === CHAR_BACKWARD_SLASH) {
          return toOrig.slice(toStart + i + 1);
        } else if (i === 2) {
          return toOrig.slice(toStart + i);
        }
      }
      if (fromLen > length) {
        if (from.charCodeAt(fromStart + i) === CHAR_BACKWARD_SLASH) {
          lastCommonSep = i;
        } else if (i === 2) {
          lastCommonSep = 3;
        }
      }
      break;
    }
    const fromCode = from.charCodeAt(fromStart + i);
    const toCode = to.charCodeAt(toStart + i);
    if (fromCode !== toCode) break;
    else if (fromCode === CHAR_BACKWARD_SLASH) lastCommonSep = i;
  }
  if (i !== length && lastCommonSep === -1) {
    return toOrig;
  }
  let out = "";
  if (lastCommonSep === -1) lastCommonSep = 0;
  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
    if (i === fromEnd || from.charCodeAt(i) === CHAR_BACKWARD_SLASH) {
      if (out.length === 0) out += "..";
      else out += "\\..";
    }
  }
  if (out.length > 0) {
    return out + toOrig.slice(toStart + lastCommonSep, toEnd);
  } else {
    toStart += lastCommonSep;
    if (toOrig.charCodeAt(toStart) === CHAR_BACKWARD_SLASH) ++toStart;
    return toOrig.slice(toStart, toEnd);
  }
}

// deno:https://jsr.io/@std/path/1.1.6/relative.ts
function relative3(from, to) {
  return isWindows ? relative2(from, to) : relative(from, to);
}

// deno:https://jsr.io/@std/path/1.1.6/resolve.ts
function resolve3(...pathSegments) {
  return isWindows ? resolve2(...pathSegments) : resolve(...pathSegments);
}

// src/engine/authoring.ts
var MARIMO_CELL_REGEX = /^\s{0,3}(`{3,})\s*(?=(?:\{)?\.?((?:python|sql|markdown)(?:\.marimo)?|marimo)(?=[\s}]))(?:(?:python|sql|markdown)\s+\{(?=(?:\.marimo(?=[\s}])|[^}]*\s\.marimo(?=[\s}])))[^}]*\}|\{(?:(?:python|sql|markdown)\.marimo(?=[\s}])|(?:python|sql|markdown)(?=\s)(?=[^}]*\s\.marimo(?=[\s}]))|\.?marimo(?=[\s}]))[^}]*\})\s*$/;
var MARKDOWN_FENCE_REGEX = /^\s{0,3}(`{3,}|~{3,})/;
var MARKDOWN_FENCE_CLOSE_REGEX = /^\s{0,3}(`{3,}|~{3,})\s*$/;
function containsMarimoFence(markdown) {
  let enclosingFence;
  for (const line of markdown.split(/\r?\n/)) {
    if (enclosingFence) {
      const closingFence = line.match(MARKDOWN_FENCE_CLOSE_REGEX)?.[1];
      if (closingFence?.[0] === enclosingFence[0] && closingFence.length >= enclosingFence.length) {
        enclosingFence = void 0;
      }
      continue;
    }
    if (MARIMO_CELL_REGEX.test(line)) return true;
    enclosingFence = line.match(MARKDOWN_FENCE_REGEX)?.[1];
  }
  return false;
}
function isMarimoCell(cell) {
  if (typeof cell.cell_type !== "object" || !("language" in cell.cell_type)) {
    return false;
  }
  const language = cell.cell_type.language;
  if (language !== "python" && language !== "sql" && language !== "markdown" && language !== "marimo" && language !== "python.marimo" && language !== "sql.marimo" && language !== "markdown.marimo") {
    return false;
  }
  const firstLine = cell.sourceVerbatim.value.split("\n", 1)[0] ?? "";
  return MARIMO_CELL_REGEX.test(firstLine);
}

// src/engine/browser-assets.ts
var EXTENSION_CONFIG = "_extension.yml";
function writeBrowserHeader(extensionDir, tempDir) {
  const version = extensionVersion(extensionDir);
  const assetsDir = join3(extensionDir, "assets");
  const browser = Deno.readTextFileSync(join3(assetsDir, `browser-v${version}.js`)).replace(/<\/script/gi, "<\\/script");
  const styles = Deno.readTextFileSync(join3(assetsDir, `islands-bridge-v${version}.css`)).replace(/<\/style/gi, "<\\/style");
  const header = [
    `<style data-marimo-islands>${styles}</style>`,
    `<script type="module" data-marimo-islands>${browser}<\/script>`
  ].join("\n");
  const path = Deno.makeTempFileSync({
    dir: tempDir,
    prefix: "marimo-header-",
    suffix: ".html"
  });
  Deno.writeTextFileSync(path, header);
  return path;
}
function extensionVersion(extensionDir) {
  const config = Deno.readTextFileSync(join3(extensionDir, EXTENSION_CONFIG));
  const match = config.match(/^version:\s*["']?([^"'\s#]+)["']?\s*$/m);
  if (!match) throw new Error("marimo extension version is missing");
  return match[1];
}

// src/engine/runtime-assets.ts
function pageResourcePaths(projectDirectory, inputFile, outputFile) {
  const project = resolve3(projectDirectory);
  const input = resolve3(inputFile);
  const inputRelative = relative3(project, input);
  if (isAbsolute3(inputRelative) || inputRelative === ".." || inputRelative.startsWith(`..${Deno.build.os === "windows" ? "\\" : "/"}`)) {
    throw new Error("marimo page input must be inside the Quarto project");
  }
  const pageOutput = outputFile ? resolve3(dirname3(input), outputFile) : input.slice(0, -extname3(input).length) + ".html";
  const pageRelative = relative3(project, pageOutput);
  if (isAbsolute3(pageRelative) || pageRelative === ".." || pageRelative.startsWith(`..${Deno.build.os === "windows" ? "\\" : "/"}`)) {
    throw new Error("marimo page output must be inside the Quarto project");
  }
  const outputDirectory = dirname3(pageOutput);
  const outputStem = basename3(pageOutput, extname3(pageOutput));
  const supportingDirectory = join3(outputDirectory, `${outputStem}_files`);
  return {
    outputDirectory,
    outputFile: pageOutput,
    supportingDirectory,
    supportingPath: relative3(project, supportingDirectory)
  };
}
function relativeAssetUrl(fromDirectory, toFile) {
  const path = relative3(fromDirectory, toFile).split("\\").join("/");
  return path.startsWith(".") ? path : `./${path}`;
}
async function writeWorkerEntry(supportingDirectory, runtimeWorkerFile) {
  const assetsDirectory = join3(supportingDirectory, "assets");
  await Deno.mkdir(assetsDirectory, {
    recursive: true
  });
  const entryPath = join3(assetsDirectory, "quarto-marimo-worker.js");
  const importUrl = relativeAssetUrl(assetsDirectory, runtimeWorkerFile);
  const contents = [
    "// Keep this a static import so the bridge's first RPC cannot race Worker setup.",
    `import ${JSON.stringify(importUrl)};`,
    ""
  ].join("\n");
  const temporary = `${entryPath}.${crypto.randomUUID()}.tmp`;
  try {
    await Deno.writeTextFile(temporary, contents);
    await Deno.rename(temporary, entryPath);
  } finally {
    await Deno.remove(temporary).catch(() => void 0);
  }
  return entryPath;
}
async function runtimeResourceFiles(runtimeDirectory, pageDirectory) {
  const files = [];
  async function collect(directory) {
    for await (const entry of Deno.readDir(directory)) {
      const path = join3(directory, entry.name);
      if (entry.isDirectory) {
        await collect(path);
      } else if (entry.isFile) {
        files.push(path);
      }
    }
  }
  await collect(runtimeDirectory);
  return files.map((file) => relative3(pageDirectory, file));
}
function localizeRuntimeAssets(assets, pageDirectory, mainFile, styleFile, expectedVersion) {
  if (assets.version !== expectedVersion) {
    throw new Error(`quarto-marimo supports marimo ${expectedVersion}; found ${assets.version ?? "unknown"}`);
  }
  const mainScripts = assets.moduleScripts.filter((source) => {
    try {
      const url = new URL(source, "https://marimo.invalid/");
      return url.pathname.endsWith("/main.js");
    } catch {
      return false;
    }
  });
  if (mainScripts.length !== 1 || assets.moduleScripts.length !== 1) {
    throw new Error("unsupported marimo islands runtime module list");
  }
  assets.moduleScripts = [
    relativeAssetUrl(pageDirectory, mainFile)
  ];
  const styles = assets.links.filter((link) => {
    try {
      const url = new URL(link.href ?? "", "https://marimo.invalid/");
      return url.pathname.endsWith("/style.css");
    } catch {
      return false;
    }
  });
  if (styles.length !== 1) {
    throw new Error("unsupported marimo islands stylesheet list");
  }
  styles[0].href = relativeAssetUrl(pageDirectory, styleFile);
}

// ../../../../../../Library/Caches/deno/npm/registry.npmjs.org/@marimo-team/mdx-marimo/0.0.5/dist/bridge/protocol/index.js
function pageCellPayload(page, cell) {
  return {
    protocolVersion: page.protocolVersion,
    app: page.app,
    cell: pageCell(cell)
  };
}
function pageCellReferencePayload(page, cell) {
  if (!page.app) return pageCellPayload(page, cell);
  return {
    protocolVersion: page.protocolVersion,
    appId: page.app.id,
    cell: pageCell(cell)
  };
}
function projectPageCellPayloads(page) {
  const indices = page.cells.map((cell) => cell.index);
  if (indices.some((index, position) => index !== position)) {
    const expected = page.cells.map((_, index) => index);
    throw new Error(`marimo compiler returned cell indices [${indices.join(", ")}]; expected [${expected.join(", ")}]`);
  }
  const carrierIndex = page.app ? page.cells.find((cell) => cell.options.render.include)?.index : void 0;
  return page.cells.map((cell) => {
    if (!cell.options.render.include) return null;
    return cell.index === carrierIndex ? pageCellPayload(page, cell) : pageCellReferencePayload(page, cell);
  });
}
function encodePageCellPayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function isCompiledMarimoPage(value) {
  return isRecord(value) && value.protocolVersion === 2 && (value.app === null || isPageRuntime(value.app)) && isArrayOf(value.cells, isCompiledCell) && isArrayOf(value.diagnostics, isDiagnostic);
}
function isCompiledCell(value) {
  return isPageCell(value) && "output" in value && isCompiledOutput(value.output);
}
function isPageCell(value) {
  return isRecord(value) && isFiniteNumber(value.index) && typeof value.html === "string" && isCellOptions(value.options) && (value.diagnostics === void 0 || isArrayOf(value.diagnostics, isDiagnostic));
}
function isCompiledOutput(value) {
  return value === null || isRecord(value) && typeof value.mimetype === "string" && isJsonValue(value.data) && typeof value.html === "string";
}
function pageCell(cell) {
  const projected = {
    index: cell.index,
    html: cell.html,
    options: cell.options
  };
  if (cell.diagnostics !== void 0) projected.diagnostics = cell.diagnostics;
  return projected;
}
function isPageRuntime(value) {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0 && isFiniteNumber(value.runtimeCellCount) && isRuntimeAssets(value.assets) && (value.notebookCode === void 0 || typeof value.notebookCode === "string");
}
function isRuntimeAssets(value) {
  return isRecord(value) && isArrayOf(value.moduleScripts, isString) && isArrayOf(value.links, isStringRecord) && (value.headTags === void 0 || isArrayOf(value.headTags, isHeadTag)) && (value.version === void 0 || typeof value.version === "string");
}
function isHeadTag(value) {
  return isRecord(value) && typeof value.tag === "string" && isStringRecord(value.attrs) && (value.text === void 0 || typeof value.text === "string");
}
function isCellOptions(value) {
  return isRecord(value) && (value.language === "python" || value.language === "sql" || value.language === "markdown") && isRenderOptions(value.render) && isRecord(value.execution) && typeof value.execution.enabled === "boolean" && isRecord(value.marimo) && typeof value.marimo.disabled === "boolean" && typeof value.marimo.unparsable === "boolean" && (value.sql === void 0 || isRecord(value.sql) && (value.sql.outputName === void 0 || typeof value.sql.outputName === "string") && (value.sql.engine === void 0 || typeof value.sql.engine === "string")) && (value.name === void 0 || typeof value.name === "string") && (value.column === void 0 || isFiniteNumber(value.column));
}
function isRenderOptions(value) {
  return isRecord(value) && typeof value.source === "boolean" && typeof value.output === "boolean" && typeof value.include === "boolean" && typeof value.editor === "boolean" && typeof value.error === "boolean" && typeof value.serverOutput === "boolean";
}
function isDiagnostic(value) {
  return isRecord(value) && (value.severity === "warning" || value.severity === "error") && typeof value.message === "string" && (value.cellIndex === void 0 || isFiniteNumber(value.cellIndex)) && (value.line === void 0 || isFiniteNumber(value.line));
}
function isJsonValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (isFiniteNumber(value)) return true;
  if (Array.isArray(value)) return Array.from(value).every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}
function isStringRecord(value) {
  return isRecord(value) && Object.values(value).every(isString);
}
function isArrayOf(value, guard) {
  return Array.isArray(value) && Array.from(value).every(guard);
}
function isString(value) {
  return typeof value === "string";
}
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// src/island-element.ts
var MARIMO_ELEMENT_NAME = "marimo-quarto-island";

// src/engine/projection.ts
async function projectInteractivePage(page, buildOutputs, htmlToMarkdown2) {
  if (buildOutputs.length !== page.cells.length) {
    throw new Error("marimo compiler returned mismatched build outputs");
  }
  const runtimePage = {
    ...page,
    cells: page.cells.map((cell) => isRenderOnly(cell) ? {
      ...cell,
      options: {
        ...cell.options,
        render: {
          ...cell.options.render,
          include: false
        }
      }
    } : cell)
  };
  const payloads = projectPageCellPayloads(runtimePage);
  return await Promise.all(page.cells.map((cell, index) => isRenderOnly(cell) ? renderStaticOutput(buildOutputs[index], htmlToMarkdown2) : Promise.resolve(payloads[index] ? rawHtml(renderIsland(payloads[index])) : "")));
}
function isRenderOnly(cell) {
  const render = cell.options.render;
  return render.renderOnly === true;
}
async function projectStaticPage(outputs, htmlToMarkdown2) {
  return await Promise.all(outputs.map((output) => renderStaticOutput(output, htmlToMarkdown2)));
}
function validateProjectionCount(projected, actualCellCount) {
  if (projected.length !== actualCellCount) {
    throw new Error(`marimo compiler returned ${projected.length} cells for ${actualCellCount} source blocks`);
  }
}
function renderIsland(payload) {
  return [
    `<${MARIMO_ELEMENT_NAME}`,
    ` data-marimo-payload="${encodePageCellPayload(payload)}"`,
    ' data-marimo-payload-encoding="base64url"',
    ' data-marimo-theme-mode="auto"',
    `></${MARIMO_ELEMENT_NAME}>`
  ].join("");
}
async function renderStaticOutput(output, htmlToMarkdown2) {
  let result = "";
  if (output.displayCode && output.code) {
    result += fencedCode(output.code, output.language);
  }
  if (!output.value) return result;
  switch (output.type) {
    case "figure":
      return `${result}![Generated Figure](<${output.value}>)

`;
    case "para":
      return `${result}${output.value}

`;
    case "plain":
      return `${result}${fencedCode(output.value)}`;
    case "blockquote":
      return `${result}> ${output.value.replace(/\r?\n/g, "\n> ")}

`;
    case "html":
      if (/<table[\s>]/i.test(output.value)) {
        return `${result}${rawHtml(output.value)}`;
      }
      return `${result}${await htmlToMarkdown2(output.value)}

`;
  }
}
function fencedCode(value, language = "") {
  const longestRun = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}
${value}
${fence}

`;
}
function rawHtml(value) {
  return fencedCode(value, "{=html}");
}

// src/engine/process.ts
var defaultCompilerTimeoutMs = 3e5;
var pythonUtf8Environment = {
  PYTHONUTF8: "1",
  PYTHONIOENCODING: "utf-8"
};
async function runMarimoCompiler(quarto2, options) {
  const extensionDir = dirname3(fromFileUrl3(options.moduleUrl));
  const extractPath = join3(extensionDir, "python", "extract.py");
  let command;
  let args;
  let temporaryDirectory;
  if (options.externalEnv) {
    command = Deno.env.get("QUARTO_PYTHON") || "python";
    args = [
      extractPath
    ];
  } else {
    command = "uv";
    const uvCommand = await constructUvCommand(quarto2, extensionDir, options.pyproject);
    temporaryDirectory = uvCommand.temporaryDirectory;
    args = [
      ...uvCommand.args,
      extractPath
    ];
  }
  args.push(options.input, options.interactive ? "html" : "static", options.globalEval ? "yes" : "no");
  if (options.interactive && options.pageResourceDirectory) {
    args.push(options.pageResourceDirectory);
  }
  let output;
  try {
    output = await executeProcess(quarto2, command, args, options.source, compilerTimeoutMs(), void 0, options.signal);
  } finally {
    if (temporaryDirectory) {
      await removeTemporaryDirectory(temporaryDirectory);
    }
  }
  const value = JSON.parse(output);
  if (isPageExecution(value) || isStaticExecution(value)) return value;
  throw new TypeError("marimo compiler returned an invalid execution payload");
}
async function constructUvCommand(quarto2, extensionDir, pyproject) {
  const commandPath = join3(extensionDir, "python", "command.py");
  const temporaryDirectory = await Deno.makeTempDir({
    prefix: "quarto-marimo-"
  });
  try {
    const output = await executeProcess(quarto2, "uv", [
      "run",
      "--with",
      "marimo",
      commandPath
    ], pyproject, compilerTimeoutMs(), {
      TEMP: temporaryDirectory,
      TMP: temporaryDirectory,
      TMPDIR: temporaryDirectory
    });
    const value = JSON.parse(output);
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
      throw new TypeError("marimo dependency resolver returned invalid uv arguments");
    }
    return {
      args: value,
      temporaryDirectory
    };
  } catch (error) {
    await removeTemporaryDirectory(temporaryDirectory);
    throw error;
  }
}
async function executeProcess(quarto2, command, args, stdin, timeoutMs = compilerTimeoutMs(), env, signal) {
  signal?.throwIfAborted();
  const child = new Deno.Command(command, {
    args,
    env: {
      ...pythonUtf8Environment,
      ...env
    },
    stdin: "piped",
    stdout: "piped",
    stderr: "piped"
  }).spawn();
  const abort = () => {
    try {
      child.kill("SIGTERM");
    } catch {
    }
  };
  signal?.addEventListener("abort", abort, {
    once: true
  });
  const outputPromise = child.output();
  const writer = child.stdin.getWriter();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    try {
      child.kill("SIGTERM");
    } catch {
    }
  }, timeoutMs);
  let output;
  try {
    await writer.write(new TextEncoder().encode(stdin));
    await writer.close();
    output = await outputPromise;
  } catch (error) {
    if (!timedOut) throw error;
    await outputPromise.catch(() => void 0);
    throw timeoutError(command, args, timeoutMs);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
  signal?.throwIfAborted();
  if (timedOut) throw timeoutError(command, args, timeoutMs);
  const stderr = new TextDecoder().decode(output.stderr);
  if (stderr) quarto2.console.info(stderr.trim());
  if (!output.success) {
    throw new Error(stderr.trim() || `${command} exited with code ${output.code}`);
  }
  return new TextDecoder().decode(output.stdout);
}
function compilerTimeoutMs() {
  const seconds = Number(Deno.env.get("QUARTO_MARIMO_TIMEOUT_SECONDS") ?? "");
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1e3 : defaultCompilerTimeoutMs;
}
function timeoutError(command, args, timeoutMs) {
  return new Error(`marimo compilation timed out after ${timeoutMs / 1e3}s while running ${[
    command,
    ...args
  ].join(" ")}`);
}
async function removeTemporaryDirectory(path) {
  await Deno.remove(path, {
    recursive: true
  }).catch(() => void 0);
}
function isPageExecution(value) {
  return isRecord2(value) && value.kind === "page" && typeof value.cacheHydration === "boolean" && Array.isArray(value.buildOutputs) && value.buildOutputs.every(isStaticOutput) && isCompiledMarimoPage(value.page);
}
function isStaticExecution(value) {
  return isRecord2(value) && value.kind === "static" && Array.isArray(value.outputs) && value.outputs.every(isStaticOutput);
}
function isStaticOutput(value) {
  return isRecord2(value) && (value.type === "html" || value.type === "figure" || value.type === "para" || value.type === "plain" || value.type === "blockquote") && typeof value.value === "string" && typeof value.displayCode === "boolean" && typeof value.code === "string" && typeof value.language === "string";
}
function isRecord2(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// src/engine/precompile.ts
var CompilerQueue = class {
  limit;
  jobs;
  waiting;
  active;
  closed;
  constructor(limit) {
    this.limit = limit;
    this.jobs = /* @__PURE__ */ new Map();
    this.waiting = [];
    this.active = 0;
    this.closed = false;
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("compiler jobs must be positive");
    }
  }
  submit(input, key, run, urgent = false) {
    if (this.closed) {
      return Promise.reject(new Error("compiler queue is closed"));
    }
    let job = this.jobs.get(key);
    if (!job) {
      for (const [oldKey, old] of this.jobs) {
        if (old.input === input) {
          old.controller.abort();
          this.jobs.delete(oldKey);
        }
      }
      let finish;
      const result = new Promise((r) => {
        finish = r;
      });
      job = {
        key,
        input,
        controller: new AbortController(),
        run,
        resolve: finish,
        result
      };
      this.jobs.set(key, job);
      this.waiting.push(job);
    }
    if (urgent) {
      const index = this.waiting.indexOf(job);
      if (index >= 0) {
        this.waiting.splice(index, 1);
        this.waiting.unshift(job);
      }
    }
    this.pump();
    return job.result.then((outcome) => {
      if ("error" in outcome) throw outcome.error;
      return outcome.value;
    });
  }
  close() {
    this.closed = true;
    for (const job of this.jobs.values()) job.controller.abort();
    for (const job of this.waiting) {
      job.resolve({
        error: new Error("compiler queue stopped")
      });
    }
    this.waiting = [];
  }
  pump() {
    while (!this.closed && this.active < this.limit && this.waiting.length) {
      const job = this.waiting.shift();
      if (job.controller.signal.aborted) {
        job.resolve({
          error: new Error("compiler request superseded")
        });
        continue;
      }
      this.active++;
      Promise.resolve().then(() => job.run(job.controller.signal)).then((value) => job.resolve({
        value
      }), (error) => job.resolve({
        error
      })).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }
};
var sessions = /* @__PURE__ */ new Map();
async function precompiledExecution(quarto2, options, request) {
  const manifest = Deno.env.get("QUARTO_MARIMO_PRECOMPILE_MANIFEST");
  if (!manifest || !request.interactive || !request.externalEnv || !options.project) return void 0;
  const sessionKey = resolve3(manifest);
  let session = sessions.get(sessionKey);
  if (!session) {
    session = Precompiler.create(quarto2, options.project, manifest, request);
    sessions.set(sessionKey, session);
  }
  return (await session).execute(request);
}
var Precompiler = class _Precompiler {
  quarto;
  project;
  manifestPath;
  scratch;
  seeded;
  queue;
  manifest;
  constructor(quarto2, project, manifestPath, scratch, manifest) {
    this.quarto = quarto2;
    this.project = project;
    this.manifestPath = manifestPath;
    this.scratch = scratch;
    this.seeded = false;
    this.manifest = manifest;
    this.queue = new CompilerQueue(manifest.jobs);
  }
  static async create(quarto2, project, path, request) {
    const manifest = JSON.parse(await Deno.readTextFile(path));
    const scratch = await Deno.makeTempDir({
      prefix: "quarto-marimo-precompile-"
    });
    const session = new _Precompiler(quarto2, project, path, scratch, manifest);
    quarto2.system.onCleanup(async () => {
      session.queue.close();
      await Deno.remove(scratch, {
        recursive: true
      }).catch(() => {
      });
    });
    const extension = dirname3(fromFileUrl3(request.moduleUrl));
    await executeProcess(quarto2, Deno.env.get("QUARTO_PYTHON") || "python", [
      join3(extension, "python", "extract.py"),
      "--prepare-runtime"
    ], "");
    return session;
  }
  async execute(request) {
    this.manifest = JSON.parse(await Deno.readTextFile(this.manifestPath));
    const page = this.page(request.input);
    if (!page) return void 0;
    const current = this.schedule(request, page.revision, true);
    current.catch(() => {
    });
    if (!this.seeded) {
      this.seeded = true;
      for (const next of this.manifest.pages) {
        const input = resolve3(this.project.dir, next.input);
        if (input === resolve3(request.input)) continue;
        const markdown = await this.project.resolveFullMarkdownForFile(void 0, input);
        if (!containsMarimoFence(markdown.value)) continue;
        const metadata = this.quarto.markdownRegex.extractYaml(markdown.value);
        if (metadata["external-env"] !== true) continue;
        const speculative = {
          ...request,
          input,
          source: markdown.value,
          globalEval: metadata.eval !== false,
          externalEnv: true,
          pyproject: String(metadata.pyproject ?? ""),
          pageResourceDirectory: void 0
        };
        this.schedule(speculative, next.revision).catch(() => {
        });
      }
    }
    const compiled = await current;
    if (request.pageResourceDirectory) {
      await Deno.remove(join3(request.pageResourceDirectory, "public", "cache"), {
        recursive: true
      }).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      });
      await copyTree(compiled.artifacts, request.pageResourceDirectory);
    }
    return structuredClone(compiled.execution);
  }
  page(input) {
    return this.manifest.pages.find((page) => page.input === relative3(this.project.dir, resolve3(input)).split("\\").join("/"));
  }
  async schedule(request, revision, urgent = false) {
    const signature = JSON.stringify({
      input: resolve3(request.input),
      source: request.source,
      interactive: request.interactive,
      globalEval: request.globalEval,
      externalEnv: request.externalEnv,
      pyproject: request.pyproject,
      revision
    });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signature));
    const key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return this.queue.submit(resolve3(request.input), key, async (signal) => {
      const artifacts = join3(this.scratch, key);
      await Deno.mkdir(artifacts, {
        recursive: true
      });
      const start = performance.now();
      this.quarto.console.info(`marimo compile start: ${this.page(request.input)?.input ?? request.input}`);
      const execution = await runMarimoCompiler(this.quarto, {
        ...request,
        pageResourceDirectory: artifacts,
        signal
      });
      this.quarto.console.info(`marimo compile done: ${this.page(request.input)?.input ?? request.input} (${((performance.now() - start) / 1e3).toFixed(2)}s)`);
      return {
        execution,
        artifacts
      };
    }, urgent);
  }
};
async function copyTree(source, destination) {
  await Deno.mkdir(destination, {
    recursive: true
  });
  for await (const entry of Deno.readDir(source)) {
    const from = join3(source, entry.name), to = join3(destination, entry.name);
    if (entry.isDirectory) await copyTree(from, to);
    else if (entry.isFile) await Deno.copyFile(from, to);
  }
}

// src/engine/index.ts
var quarto;
var marimoEngineDiscovery = {
  init: (quartoAPI) => {
    quarto = quartoAPI;
  },
  name: "marimo",
  defaultExt: ".qmd",
  defaultYaml: () => [
    "format: html",
    "engine: marimo"
  ],
  defaultContent: () => [
    "```{python .marimo}",
    "import marimo as mo",
    "slider = mo.ui.slider(1, 10, 1)",
    "slider",
    "```"
  ],
  validExtensions: () => [
    ".qmd",
    ".md"
  ],
  claimsFile: (file, extension) => {
    if (![
      ".qmd",
      ".md"
    ].includes(extension.toLowerCase())) return false;
    try {
      return containsMarimoFence(Deno.readTextFileSync(file));
    } catch {
      return false;
    }
  },
  claimsLanguage: (language, firstClass) => {
    if ((language === "python" || language === "sql" || language === "markdown") && firstClass === "marimo") {
      return 2;
    }
    if (language === "python.marimo" || language === "sql.marimo" || language === "markdown.marimo" || language === "marimo") {
      return 1;
    }
    return false;
  },
  canFreeze: false,
  generatesFigures: true,
  checkInstallation: async (configuration) => {
    const report = {};
    if (configuration.jsonResult) {
      const render = configuration.jsonResult.render ??= {};
      render.marimo = report;
    }
    const checkRender = async () => {
      const result = await quarto.system.checkRender({
        content: "```{python .marimo}\n1 + 1\n```\n",
        language: "python",
        services: configuration.services
      });
      if (result.error) {
        if (configuration.jsonResult) {
          report.error = result.error.message;
          return;
        }
        throw result.error;
      }
      report.ok = true;
    };
    if (configuration.jsonResult) {
      await checkRender();
    } else {
      const message = "Checking marimo engine render...";
      await quarto.console.withSpinner({
        message,
        doneMessage: `${message}OK
`
      }, checkRender);
    }
  },
  launch: (_context) => ({
    name: marimoEngineDiscovery.name,
    canFreeze: marimoEngineDiscovery.canFreeze,
    markdownForFile(file) {
      return Promise.resolve(quarto.mappedString.fromFile(file));
    },
    target: (file, _quiet, markdown) => {
      const source = markdown ?? quarto.mappedString.fromFile(file);
      return Promise.resolve({
        source: file,
        input: file,
        markdown: source,
        metadata: quarto.markdownRegex.extractYaml(source.value)
      });
    },
    partitionedMarkdown: (file) => Promise.resolve(quarto.markdownRegex.partition(Deno.readTextFileSync(file))),
    execute: async (options) => {
      const interactive = quarto.format.isHtmlCompatible(options.format);
      const extensionDir = dirname3(fromFileUrl3(import.meta.url));
      const canUsePageResources = interactive && !Deno.env.get("QUARTO_MARIMO_DEBUG_ENDPOINT");
      const outputFile = outputFileMetadata(options);
      const resourcePaths = canUsePageResources ? pageResourcePaths(options.project.dir, options.target.input, outputFile) : void 0;
      const request = {
        moduleUrl: import.meta.url,
        source: options.target.markdown.value,
        input: options.target.input,
        interactive,
        globalEval: options.target.metadata.eval !== false,
        externalEnv: options.target.metadata["external-env"] === true,
        pyproject: String(options.target.metadata.pyproject ?? ""),
        pageResourceDirectory: resourcePaths?.supportingDirectory
      };
      const execution = await quarto.console.withSpinner({
        message: "Executing marimo cells..."
      }, async () => await precompiledExecution(quarto, options, request) ?? await runMarimoCompiler(quarto, request));
      const supporting = [];
      let resourceFiles;
      if (execution.kind === "page" && execution.cacheHydration && resourcePaths && execution.page.app) {
        const manifest = JSON.parse(Deno.readTextFileSync(join3(extensionDir, "runtime-patch.json")));
        const runtimeDirectory = join3(extensionDir, "assets", "runtime", "islands", manifest.version, "dist");
        const runtimeMain = join3(runtimeDirectory, manifest.mainFile);
        const mainSource = Deno.readTextFileSync(runtimeMain);
        const workerMatches = mainSource.match(new RegExp(manifest.workerPattern, "g")) ?? [];
        if (workerMatches.length !== 1) {
          throw new Error("pinned islands bundle has no unique Worker asset");
        }
        const runtimeWorker = join3(runtimeDirectory, workerMatches[0].replace(/^\//, ""));
        const runtimeStyle = join3(runtimeDirectory, manifest.styleFile);
        await writeWorkerEntry(resourcePaths.supportingDirectory, runtimeWorker);
        localizeRuntimeAssets(execution.page.app.assets, resourcePaths.outputDirectory, runtimeMain, runtimeStyle, manifest.version);
        supporting.push(resourcePaths.supportingDirectory);
        resourceFiles = await runtimeResourceFiles(runtimeDirectory, resourcePaths.outputDirectory);
      }
      const chunks = await quarto.markdownRegex.breakQuartoMd(options.target.markdown, false, false, MARIMO_CELL_REGEX);
      const marimoCells = chunks.cells.filter(isMarimoCell);
      const projected = execution.kind === "page" ? await projectInteractivePage(execution.page, execution.buildOutputs, htmlToMarkdown) : await projectStaticPage(execution.outputs, htmlToMarkdown);
      validateProjectionCount(projected, marimoCells.length);
      let index = 0;
      const markdown = chunks.cells.map((cell) => isMarimoCell(cell) ? projected[index++] ?? "" : cell.sourceVerbatim.value).join("");
      const includes = {};
      if (execution.kind === "page") {
        includes["include-in-header"] = [
          writeBrowserHeader(extensionDir, options.tempDir)
        ];
      }
      return {
        engine: "marimo",
        markdown,
        supporting,
        filters: [],
        includes,
        resourceFiles
      };
    },
    dependencies: (_options) => Promise.resolve({
      includes: {}
    }),
    postprocess: (_options) => Promise.resolve()
  })
};
function outputFileMetadata(options) {
  const metadata = options.target.metadata;
  const targetOutput = metadata["output-file"];
  if (typeof targetOutput === "string" && targetOutput.trim()) {
    return targetOutput;
  }
  const render = options.format.render;
  const formatOutput = render["output-file"];
  return typeof formatOutput === "string" && formatOutput.trim() ? formatOutput : void 0;
}
async function htmlToMarkdown(html) {
  const result = await quarto.system.pandoc([
    "-f",
    "html",
    "-t",
    "markdown"
  ], html);
  if (!result.success) {
    throw new Error(result.stderr || "Pandoc could not convert marimo HTML");
  }
  return result.stdout || "";
}
var engine_default = marimoEngineDiscovery;
export {
  engine_default as default
};
