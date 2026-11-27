'use client';

import {useState} from 'react';
import {colorSchemes,customColorScheme,defaultColorSchemeId,resolveColorScheme,schemeColor,type ColorScheme,type ColorSchemeChoice} from '../color-schemes';

/** The header, accent, and background tint each scheme produces, shown as swatches. */
const sampleBrands=['1e5848','3d966e','eaf1ed'] as const;

function Swatches({scheme}:{scheme:ColorScheme}){
 return <span className="color-scheme-swatches" aria-hidden="true">{sampleBrands.map(brand=><span key={brand} style={{background:scheme.id===defaultColorSchemeId?`#${brand}`:schemeColor(scheme,brand)}}/>)}</span>;
}

/** Chooses the app's color scheme. The choice applies at once and is kept for this Windows user on this computer. */
export function ColorSchemeModal({choice,onChoose}:{choice:ColorSchemeChoice;onChoose:(choice:ColorSchemeChoice)=>void}){
 const active=resolveColorScheme(choice),[custom,setCustom]=useState(choice.custom??'#277457'),customScheme=customColorScheme(custom);
 return <><p className="eyebrow">System Tools</p><h2>Color Scheme</h2>
  <p className="hint">Choose the colors for headers, buttons, and highlights. Red and gold keep their meaning (problems and warnings) in every scheme. Light or dark mode is still set with the Dark Mode button.</p>
  {/* A choice applies and is saved at once, so closing never needs the unsaved-changes prompt. */}
  <div className="color-scheme-list" role="radiogroup" aria-label="Color Scheme" data-ignore-unsaved>
   {colorSchemes.map(scheme=><label key={scheme.id} className={active.id===scheme.id?'selected':''}><input type="radio" name="color-scheme" checked={active.id===scheme.id} onChange={()=>onChoose({id:scheme.id})}/><Swatches scheme={scheme}/><span><strong>{scheme.label}</strong><small>{scheme.description}</small></span></label>)}
   <label className={active.id==='custom'?'selected':''}><input type="radio" name="color-scheme" checked={active.id==='custom'} disabled={!customScheme} onChange={()=>onChoose({id:'custom',custom})}/>{customScheme&&<Swatches scheme={customScheme}/>}<span><strong>Custom</strong><small>Pick any color; the app uses its hue and strength.</small></span><input type="color" aria-label="Custom Color" value={custom} onChange={event=>{setCustom(event.target.value);onChoose({id:'custom',custom:event.target.value})}}/></label>
  </div>
  <div className="directory-actions"><button type="button" disabled={active.id===defaultColorSchemeId} onClick={()=>onChoose({id:defaultColorSchemeId})}>Restore Original Colors</button></div>
 </>;
}
