import React from 'react'

export default function ConfirmModal({ open, title, message, onConfirm, onCancel }){
  if (!open) return null
  return (
    <div style={{position:'fixed', inset:0, background:'linear-gradient(rgba(15,23,42,0.6), rgba(2,6,23,0.6))', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999}}>
      <div style={{width:380, maxWidth:'90%', background:'#0f172a', color:'#e6eef8', borderRadius:10, padding:18, boxShadow:'0 12px 40px rgba(2,6,23,0.6)', fontFamily:'Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial'}}>
        <div style={{display:'flex', alignItems:'center'}}>
          <div style={{width:44, height:44, borderRadius:22, background:'#ffe4e6', color:'#7f1d1d', display:'flex', alignItems:'center', justifyContent:'center', marginRight:12, fontWeight:700}}>!</div>
          <div style={{flex:1}}>
            <div style={{fontSize:16, fontWeight:700}}>{title || 'Confirm delete'}</div>
            <div style={{marginTop:6, color:'#c7d2fe', fontSize:13}}>{message}</div>
          </div>
        </div>
        <div style={{display:'flex', justifyContent:'flex-end', marginTop:16}}>
          <button onClick={onCancel} style={{marginRight:8, background:'transparent', color:'#c7d2fe', border:'1px solid rgba(231,233,255,0.06)', padding:'6px 10px', borderRadius:6}}>Cancel</button>
          <button onClick={onConfirm} style={{background:'#ef4444', color:'#fff', border:'none', padding:'8px 12px', borderRadius:8}}>Delete</button>
        </div>
      </div>
    </div>
  )
}
