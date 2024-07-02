import { Pos } from "./adapter";

export function findFirstNonWhiteSpaceCharacter(text: string) {
  if (!text) {
    return 0;
  }
  const firstNonWS = text.search(/\S/);
  return firstNonWS == -1 ? text.length : firstNonWS;
}

export function isLowerCase(k: string) {
  return /^[a-z]$/.test(k);
}
export function isMatchableSymbol(k: string) {
  return "()[]{}".includes(k);
}
const numberRegex = /[\d]/;
export function isNumber(k: string) {
  return numberRegex.test(k);
}

const upperCaseChars = /^[\p{Lu}]$/u;

export function isUpperCase(k: string) {
  return upperCaseChars.test(k);
}
export function isWhiteSpaceString(k: string) {
  return /^\s*$/.test(k);
}
export function isEndOfSentenceSymbol(k: string) {
  return ".?!".includes(k);
}
export function inArray<T>(val: T, arr: T[]) {
  return arr.includes(val);
}

export const copyCursor = (cur: Pos): Pos => ({ ...cur });

export const cursorEqual = (cur1: Pos, cur2: Pos): boolean =>
  cur1.ch == cur2.ch && cur1.line == cur2.line;

export const cursorIsBefore = (cur1: Pos, cur2: Pos): boolean => {
  if (cur1.line < cur2.line) {
    return true;
  }
  if (cur1.line == cur2.line && cur1.ch < cur2.ch) {
    return true;
  }
  return false;
};

export const cursorMin = (...cursors: Pos[]): Pos =>
  cursors.reduce((m, cur) => (cursorIsBefore(m, cur) ? m : cur));

export const cursorMax = (...cursors: Pos[]): Pos =>
  cursors.reduce((m, cur) => (cursorIsBefore(m, cur) ? cur : m));

export const cursorIsBetween = (low: Pos, test: Pos, high: Pos): boolean =>
  // returns true if cur2 is between cur1 and cur3.
  cursorIsBefore(low, test) && cursorIsBefore(test, high);
