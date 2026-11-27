/**
 * Color schemes. Every brand (green-family) color in globals.css is written as var(--rc-<hex>,#<hex>), so with no
 * scheme the app looks exactly as designed. A scheme sets those variables to the same colors moved to another hue,
 * keeping each color's lightness so text contrast and the light/dark relationships stay the same. Gold, red, and
 * the other status colors are not brand colors and never change, so their meaning is the same in every scheme.
 */
export const brandColors=['08140f','101715','101915','103e32','111916','131c18','163f34','17231f','17392f','17654f','18251e','183127','18342b','19231f','1c755b','1e5848','1f6a4b','24322d','27352f','277457','2a6151','2c8067','2d3b35','2f4a40','31423b','344b41','3d966e','3f9e78','405049','41534b','42574e','49645a','4c776b','4d7769','4f9b78','52645d','52665e','56675f','596861','5c6d66','5e7069','61736c','677971','70b89f','80a397','84948d','85d7bb','86cfb2','8a9993','8cc3b0','8fd3bb','9fb4aa','a7b8b0','a9d4c6','afc0b9','b7c7bf','b9c9c2','b9cec5','bcd6ce','bdd5cb','bdf0dc','bfcac5','c7d3ce','cad8d2','ccd7d2','d5e2dc','d8e2dd','d8e6df','d8e7e1','daf0e5','dbe3df','dce4e0','dce5e0','e0e7e3','e4e9e6','e4ece8','e5f4ed','e7ece9','e7eeeb','e7f1ed','e7f4ef','e9eeec','eaf1ed','edf1ee','edf4f1','edf5f1','edf7f2','edf7f3','f2f7f4','f3f8f5','f4f7f5','f5f8f6','f8fbf9'] as const;

/** The hue and saturation of the app's main brand color (#277457), which every scheme is measured against. */
const brandHue=157,brandSaturation=0.5;

export type ColorScheme={id:string;label:string;description:string;hue:number;saturation:number};
export const defaultColorSchemeId='raptor';
/** Hues avoid red and gold, which mean "problem" and "warning" throughout the app. */
export const colorSchemes:readonly ColorScheme[]=[
 {id:'raptor',label:'R.A.P.T.O.R. Green',description:'The original colors.',hue:brandHue,saturation:1},
 {id:'navy',label:'Navy Blue',description:'Deep blue headers and accents.',hue:214,saturation:1},
 {id:'teal',label:'Teal',description:'Blue-green, close to the original.',hue:186,saturation:1},
 {id:'slate',label:'Slate Gray',description:'Muted, nearly gray.',hue:212,saturation:0.25},
 {id:'purple',label:'Purple',description:'Violet headers and accents.',hue:268,saturation:0.9},
];

export type ColorSchemeChoice={id:string;custom?:string};
export const colorSchemeStorageKey='raptor-color-scheme-v1';

type Hsl={h:number;s:number;l:number};
function toHsl(hex:string):Hsl{
 const r=parseInt(hex.slice(0,2),16)/255,g=parseInt(hex.slice(2,4),16)/255,b=parseInt(hex.slice(4,6),16)/255,max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/2;
 if(max===min)return{h:0,s:0,l};
 const d=max-min,s=l>0.5?d/(2-max-min):d/(max+min),h=max===r?((g-b)/d+(g<b?6:0)):max===g?(b-r)/d+2:(r-g)/d+4;
 return{h:h*60,s,l};
}
function toHex({h,s,l}:Hsl){
 const a=s*Math.min(l,1-l),channel=(n:number)=>{const k=(n+h/30)%12,value=l-a*Math.max(-1,Math.min(k-3,9-k,1));return Math.round(Math.max(0,Math.min(1,value))*255).toString(16).padStart(2,'0')};
 return`#${channel(0)}${channel(8)}${channel(4)}`;
}

/** A custom color becomes a scheme with its hue and its saturation relative to the brand color. */
export function customColorScheme(color:string):ColorScheme|undefined{
 const hex=/^#?([0-9a-f]{6})$/i.exec(color.trim())?.[1]?.toLowerCase();if(!hex)return undefined;
 const {h,s}=toHsl(hex),picked=Math.round(h),hue=allowedHue(picked);
 // A gray has no hue to move, so it is never reported as adjusted.
 return{id:'custom',label:'Custom',description:hue!==picked&&s>0?`Built from #${hex}, moved off red and gold.`:`Built from #${hex}.`,hue,saturation:Math.max(0,Math.min(1.6,s/brandSaturation))};
}

/** Red and gold mean "problem" and "warning", so brand colors stay between these hues (yellow-green through magenta). */
export const allowedHueRange={from:70,to:300} as const;
/** The hue itself when allowed; otherwise the nearer edge of the allowed range, measured around the color wheel. */
export function allowedHue(hue:number){
 const value=((hue%360)+360)%360,{from,to}=allowedHueRange;
 if(value>=from&&value<=to)return value;
 const toFrom=value<from?from-value:from+360-value,toTo=value>to?value-to:value+360-to;
 return toFrom<=toTo?from:to;
}

/** The color one brand color takes in a scheme: same lightness, the scheme's hue offset, and scaled saturation. */
export function schemeColor(scheme:ColorScheme,brand:string){
 const {h,s,l}=toHsl(brand);
 return toHex({h:((h-brandHue+scheme.hue)%360+360)%360,s:Math.max(0,Math.min(1,s*scheme.saturation)),l});
}

/** The CSS variables a scheme sets; the original scheme sets none, so the stylesheet's own colors show. */
export function schemeVariables(scheme:ColorScheme):Record<string,string>{
 if(scheme.id===defaultColorSchemeId)return{};
 return Object.fromEntries(brandColors.map(brand=>[`--rc-${brand}`,schemeColor(scheme,brand)]));
}

export function resolveColorScheme(choice:ColorSchemeChoice|null|undefined):ColorScheme{
 if(choice?.id==='custom'&&choice.custom){const custom=customColorScheme(choice.custom);if(custom)return custom}
 return colorSchemes.find(scheme=>scheme.id===choice?.id)??colorSchemes[0];
}

/** Reads a saved choice; anything unexpected falls back to the original colors. */
export function parseColorSchemeChoice(raw:string|null):ColorSchemeChoice{
 try{const value=raw?JSON.parse(raw) as {id?:unknown;custom?:unknown}:null;if(value&&typeof value.id==='string'&&value.id.length<=40)return{id:value.id,...(typeof value.custom==='string'&&value.custom.length<=9?{custom:value.custom}:{})}}catch{}
 return{id:defaultColorSchemeId};
}

/** Applies a scheme to the page by setting (or clearing) the brand color variables on the root element. */
export function applyColorScheme(scheme:ColorScheme,root:{style:{setProperty(name:string,value:string):void;removeProperty(name:string):string}}){
 const variables=schemeVariables(scheme);
 for(const brand of brandColors){const name=`--rc-${brand}`,value=variables[name];if(value)root.style.setProperty(name,value);else root.style.removeProperty(name)}
}
