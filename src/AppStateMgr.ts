// Application state management

import {Point} from "function-curve-editor";
import * as Fflate from "fflate";
import Varint from "varint";

import * as Utils from "./Utils.ts";
import {UniFunction} from "./Utils.ts";

const defaultSampleRate                = 44100;
const defaultAgcRmsLevel               = 0.18;

// Simple example:
// const defaultSpectrumCurveKnots        = convertKnotsArray([[70, -62], [1100, -25], [2600, -68], [4200, -40], [5500, -71]]);
// const defaultAmplitudeCurveKnots       = convertKnotsArray([[0, -50], [0.15, -27], [0.4, -10], [1, -5], [2, -5], [2.7, -12], [2.9, -30], [3, -50]]);
// const defaultFrequencyCurveKnots       = convertKnotsArray([[0, 200], [1.5, 600], [3, 200]]);
// Example ZHCorpus Sound 183980:
const defaultSpectrumCurveKnots        = convertKnotsArray([[50, -83.1], [188, -54.3], [327, -50.4], [465, -41], [604, -47.5], [742, -65], [881, -66.4], [1019, -67.4], [1158, -72.1], [1296, -73.6], [1435, -68.4], [1573, -68.3], [1712, -71.5], [1850, -66.4], [1988, -57.7], [2127, -55.3], [2265, -53.5], [2404, -53.5], [2542, -53], [2681, -54.6], [2819, -56], [2958, -60.4], [3096, -60.8], [3235, -62.9], [3373, -58.1], [3512, -53.4], [3650, -54.5], [3788, -56.9], [3927, -64.2], [4065, -69.7], [4204, -84.3], [4342, -90.5], [4481, -92.8], [4619, -90.9], [4758, -86.4], [4896, -86.7], [5035, -89], [5173, -85.8], [5312, -84.1], [5450, -84.4]]);
const defaultAmplitudeCurveKnots       = convertKnotsArray([[0.01, -67.1], [0.09, -64.8], [0.17, -16.3], [0.25, -18.1], [0.33, -15.8], [0.410000, -15.0000], [0.49, -13.6], [0.570000, -13.4000], [0.65, -15], [0.73, -13.7], [0.81, -15], [0.89, -13.8], [0.97, -14.8], [1.05, -14.4], [1.13000, -13.9000], [1.21, -14], [1.29, -14.1], [1.37, -14.2], [1.45, -15.6], [1.53, -13.5], [1.61, -16.5], [1.69, -22.9], [1.77, -46], [1.85, -56.4], [1.93, -65.3]]);
const defaultFrequencyCurveKnots       = convertKnotsArray([[0, 191.55], [0.03, 191.55], [0.06, 191.55], [0.09, 191.55], [0.12, 192.97], [0.15, 213.11], [0.18, 227.74], [0.21, 241.75], [0.24, 249.36], [0.27, 249.00], [0.3, 245.62], [0.33, 248.59], [0.36, 251.36], [0.39, 252.64], [0.42, 248.41], [0.45, 247.53], [0.48, 248.88], [0.51, 252.39], [0.54, 254.38], [0.57, 248.74], [0.6, 246.78], [0.63, 252.36], [0.66, 251.99], [0.69, 253.04], [0.72, 250.64], [0.75, 251.26], [0.78, 250.80], [0.81, 252.73], [0.84, 255.43], [0.87, 252.65], [0.9, 250.22], [0.93, 252.21], [0.96, 252.09], [0.99, 246.65], [1.02, 246.54], [1.05, 251.80], [1.08, 254.48], [1.11, 252.66], [1.14, 248.56], [1.17, 246.42], [1.2, 249.97], [1.23, 251.73], [1.26, 252.75], [1.29, 251.66], [1.32, 250.59], [1.35, 248.77], [1.38, 248.49], [1.41, 254.72], [1.44, 256.25], [1.47, 252.44], [1.5, 252.08], [1.53, 250.92], [1.56, 252.95], [1.59, 252.56], [1.62, 255.36], [1.65, 250.03], [1.68, 240.90], [1.71, 241.56], [1.74, 240.52], [1.77, 234.60], [1.8, 246.93]]);

function convertKnotsArray (a: number[][]) : Point[] {
   return a.map((e) => <Point>{x: e[0], y: e[1]}); }

//--- Curve knot compression ---------------------------------------------------

const enum CurveDataType {
   timeAsc,                  // time values in seconds, ascending
   freq,                     // frequency values in Hz
   freqAsc,                  // frequency values in Hz, ascending
   db }                      // dB values

interface CurveDataTypeSpec {
   decDigits:                number;
   ascending:                boolean;
   minValue:                 number;
   maxValue:                 number; }

const curveDataTypeSpecMap : Record<CurveDataType, CurveDataTypeSpec> = {
   [CurveDataType.timeAsc]: {decDigits: 3, ascending: true,  minValue: 0,    maxValue: 36000 },
   [CurveDataType.freq]:    {decDigits: 0, ascending: false, minValue: 0,    maxValue: 100000},
   [CurveDataType.freqAsc]: {decDigits: 0, ascending: true,  minValue: 0,    maxValue: 100000},
   [CurveDataType.db]:      {decDigits: 1, ascending: false, minValue: -200, maxValue: 200   }};

// Returns an integer.
function quantize (x: number, decDigits: number, minValue: number, maxValue: number) : number {
   const x2 = Math.max(minValue, Math.min(maxValue, x));
   return Math.round(x2 * 10 ** decDigits); }

// Returns a float value.
function dequantize (i: number, decDigits: number) : number {
   return i / 10 ** decDigits; }

function quantizeArray (a: ArrayLike<number>, decDigits: number, minValue: number, maxValue: number) : Int32Array {
   const n = a.length;
   const a2 = new Int32Array(n);
   for (let i = 0; i < n; i++) {
      a2[i] = quantize(a[i], decDigits, minValue, maxValue); }
   return a2; }

function dequantizeArray (a: Int32Array, decDigits: number) : Float64Array {
   const n = a.length;
   const a2 = new Float64Array(n);
   for (let i = 0; i < n; i++) {
      a2[i] = dequantize(a[i], decDigits); }
   return a2; }

function differentiate (a: Int32Array) : Int32Array {
   const n = a.length;
   const a2 = new Int32Array(n);
   for (let i = 0; i < n; i++) {
      a2[i] = a[i] - ((i > 0) ? a[i - 1] : 0); }
   return a2; }

function integrate (a: Int32Array) : Int32Array {
   const n = a.length;
   const a2 = new Int32Array(n);
   for (let i = 0; i < n; i++) {
      a2[i] = a[i] + ((i > 0) ? a2[i - 1] : 0); }
   return a2; }

function wrapSign (i: number) : number {
   return (i < 0) ? -i * 2 + 1 : i * 2; }

function unwrapSign (i: number) : number {
   return (i & 1) ? - (i >>> 1) : (i >>> 1); }

function varIntEncodeArray (inp: Int32Array) : Uint8Array {
   const outLen = inp.reduce((acc, x) => acc + Varint.encodingLength(x), 0);
   const out = new Uint8Array(outLen);
   let p = 0;
   for (const x of inp) {
      if (x < 0) {
         throw new Error("Program logic error: Negative varint value."); }
      Varint.encode(x, out, p);
      p += Varint.encode.bytes!; }
   if (p != outLen) {
      throw new Error("Program logic error: VarInt encode output buffer size mismatch."); }
   return out; }

function varIntDecodeArray (inp: Uint8Array) : Int32Array {
   const outLen = inp.reduce((acc, x) => acc + ((x & 0x80) ? 0 : 1), 0);
   const out = new Int32Array(outLen);
   let p1 = 0;
   let p2 = 0;
   while (p1 < inp.length) {
      out[p2++] = Varint.decode(inp, p1);
      p1 += Varint.decode.bytes!; }
   if (p2 != outLen) {
      throw new Error("Program logic error: VarInt decode output buffer size mismatch."); }
   return out; }

function encodeCurveDataByType (curveData: ArrayLike<number>, dataType: CurveDataType) : string {
   const dts = curveDataTypeSpecMap[dataType];
   const a1 = quantizeArray(curveData, dts.decDigits, dts.minValue, dts.maxValue);
   const a2 = differentiate(a1);
   const a3 = dts.ascending ? a2 : a2.map(wrapSign);
   const a4 = varIntEncodeArray(a3);
   const a5 = Fflate.deflateSync(a4, {level: 9});
   const b64 = Utils.encodeBase64UrlBuf(a5);
   return b64; }

function decodeCurveDataByType (b64: string, dataType: CurveDataType) : Float64Array {
   const dts = curveDataTypeSpecMap[dataType];
   const a1 = Utils.decodeBase64UrlBuf(b64);
   const a2 = Fflate.inflateSync(a1);
   const a3 = varIntDecodeArray(a2);
   const a4 = dts.ascending ? a3 : a3.map(unwrapSign);
   const a5 = integrate(a4);
   const a6 = dequantizeArray(a5, dts.decDigits);
   return a6; }

//--- URL set/get --------------------------------------------------------------

function setStr (usp: URLSearchParams, parmName: string, parmValue: string) {
   if (!parmValue) {
      return; }
   usp.set(parmName, parmValue); }

function getStr (usp: URLSearchParams, parmName: string) : string {
   const s = usp.get(parmName);
   if (!s) {
      return ""; }
   return s; }

function setNum (usp: URLSearchParams, parmName: string, parmValue: number, defaultValue = NaN) {
   if (isNaN(parmValue) || parmValue == defaultValue) {
      return; }
   usp.set(parmName, String(parmValue)); }

function getNum (usp: URLSearchParams, parmName: string, defaultValue = NaN) : number {
   const s = usp.get(parmName);
   if (!s) {
      return defaultValue; }
   const v = Number(s);
   if (isNaN(v)) {
      throw new Error(`Invalid value "${s}" for numeric URL parameter "${parmName}".`); }
   return v; }

function compareKnots (knots1: Point[], knots2: Point[]) : boolean {
   if (knots1.length != knots2.length) {
      return false; }
   const eps = 1E-6;
   for (let i = 0; i < knots1.length; i++) {
      const p1 = knots1[i];
      const p2 = knots2[i];
      if (Math.abs(p1.x - p2.x) > eps || Math.abs(p1.y - p2.y) > eps) {
         return false; }}
   return true; }

function setKnots (usp: URLSearchParams, parmName: string, knots: Point[], xDataType: CurveDataType, yDataType: CurveDataType, defaultValue: Point[]) {
   if (!knots || compareKnots(knots, defaultValue)) {
      return; }
   const xVals = knots.map((e) => e.x);
   const yVals = knots.map((e) => e.y);
   const xStr = encodeCurveDataByType(xVals, xDataType);
   const yStr = encodeCurveDataByType(yVals, yDataType);
   usp.set(parmName, xStr + "*" + yStr); }

function getKnots (usp: URLSearchParams, parmName: string, xDataType: CurveDataType, yDataType: CurveDataType, defaultValue: Point[]) : Point[] {
   const s = usp.get(parmName);
   if (!s) {
      return defaultValue; }
   const sa = s.split("*");
   if (sa.length != 2) {
      throw new Error("Invalid encoded curve knots value structure."); }
   const xStr = sa[0];
   const yStr = sa[1];
   const xVals = decodeCurveDataByType(xStr, xDataType);
   const yVals = decodeCurveDataByType(yStr, yDataType);
   if (xVals.length != yVals.length) {
      throw new Error("Length mismatch of encoded curve knots x/y components."); }
   const knots = Array.from(xVals, (x, i) => ({x, y: yVals[i]}));
   return knots; }

//------------------------------------------------------------------------------

// Note: The x coordinates of the points are guaranteed to be ascending for all data types.
export interface AppState {
   sampleRate:               number;
   agcRmsLevel:              number;
   f0Multiplier:             number;
   specMultiplier:           number;
   specShift:                number;
   evenAmplShift:            number;
   spectrumCurveKnots:       Point[];
   amplitudeCurveKnots:      Point[];
   frequencyCurveKnots:      Point[];
   reference:                string; }

export interface AppStateUpdate extends Partial<AppState> {
   origSpecCurveFunction?:   UniFunction; }                // used to visualize the original smoothed spectrum curve from the analysis

export function encodeAppStateUrlParms (appState: AppState) : string {
   const usp = new URLSearchParams();
   setNum(usp, "sampleRate",     appState.sampleRate,     defaultSampleRate);
   setNum(usp, "agcRmsLevel",    appState.agcRmsLevel,    defaultAgcRmsLevel);
   setNum(usp, "f0Multiplier",   appState.f0Multiplier,   1);
   setNum(usp, "specMultiplier", appState.specMultiplier, 1);
   setNum(usp, "specShift",      appState.specShift,      0);
   setNum(usp, "evenAmplShift",  appState.evenAmplShift,  0);
   setKnots(usp, "spectrumCurve",  appState.spectrumCurveKnots,  CurveDataType.freqAsc, CurveDataType.db,   defaultSpectrumCurveKnots);
   setKnots(usp, "amplitudeCurve", appState.amplitudeCurveKnots, CurveDataType.timeAsc, CurveDataType.db,   defaultAmplitudeCurveKnots);
   setKnots(usp, "frequencyCurve", appState.frequencyCurveKnots, CurveDataType.timeAsc, CurveDataType.freq, defaultFrequencyCurveKnots);
   setStr(usp, "ref", appState.reference);
   return usp.toString(); }

export function decodeAppStateUrlParms (urlParmsString: string) : AppState {
   const usp = new URLSearchParams(urlParmsString);
   const appState = <AppState>{};
   appState.sampleRate     = getNum(usp, "sampleRate",     defaultSampleRate);
   appState.agcRmsLevel    = getNum(usp, "agcRmsLevel",    defaultAgcRmsLevel);
   appState.f0Multiplier   = getNum(usp, "f0Multiplier",   1);
   appState.specMultiplier = getNum(usp, "specMultiplier", 1);
   appState.specShift      = getNum(usp, "specShift",      0);
   appState.evenAmplShift  = getNum(usp, "evenAmplShift",  0);
   appState.spectrumCurveKnots  = getKnots(usp, "spectrumCurve",  CurveDataType.freqAsc, CurveDataType.db,   defaultSpectrumCurveKnots);
   appState.amplitudeCurveKnots = getKnots(usp, "amplitudeCurve", CurveDataType.timeAsc, CurveDataType.db,   defaultAmplitudeCurveKnots);
   appState.frequencyCurveKnots = getKnots(usp, "frequencyCurve", CurveDataType.timeAsc, CurveDataType.freq, defaultFrequencyCurveKnots);
   appState.reference = getStr(usp, "ref");
   return appState; }
