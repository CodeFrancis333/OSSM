const express = require('express')
const path = require('path')
const cors = require('cors')
const fs = require('fs')

const app = express()
app.use(cors())
app.use(express.json())

const DATA_DIR = path.join(__dirname, '..', 'data')

app.get('/api/rebar', (req, res) => {
  const p = path.join(DATA_DIR, 'rebar_ph.json')
  fs.readFile(p, 'utf8', (err, data)=>{
    if (err) return res.status(500).json({error: 'read error'})
    try{
      res.json(JSON.parse(data))
    }catch(e){
      res.status(500).json({error:'parse error'})
    }
  })
})

app.get('/api/detailing', (req, res) => {
  const p = path.join(DATA_DIR, 'detailing_rules.json')
  fs.readFile(p, 'utf8', (err, data)=>{
    if (err) return res.status(500).json({error: 'read error'})
    try{
      res.json(JSON.parse(data))
    }catch(e){
      res.status(500).json({error:'parse error'})
    }
  })
})

app.get('/api/aisc', (req, res) => {
  const p = path.join(DATA_DIR, 'aisc_v16.json')
  fs.readFile(p, 'utf8', (err, data)=>{
    if (err) return res.status(500).json({error: 'read error'})
    try{
      res.json(JSON.parse(data))
    }catch(e){
      res.status(500).json({error:'parse error'})
    }
  })
})

// BOM endpoints
app.get('/api/bom', (req, res) => {
  const p = path.join(DATA_DIR, 'bom.json')
  fs.readFile(p, 'utf8', (err, data)=>{
    if (err) return res.status(500).json({error: 'read error'})
    try{
      res.json(JSON.parse(data))
    }catch(e){ res.status(500).json({error:'parse error'}) }
  })
})

app.post('/api/bom', (req, res) => {
  const p = path.join(DATA_DIR, 'bom.json')
  const payload = req.body || []
  if (!Array.isArray(payload)) return res.status(400).json({error:'invalid payload'})
  fs.writeFile(p, JSON.stringify(payload, null, 2), 'utf8', (err)=>{
    if (err) return res.status(500).json({error:'write error'})
    res.json({ok:true})
  })
})

app.get('/api/bom/export', (req, res) => {
  const type = (req.query.type || 'json').toLowerCase()
  const p = path.join(DATA_DIR, 'bom.json')
  fs.readFile(p, 'utf8', (err, data)=>{
    if (err) return res.status(500).json({error: 'read error'})
    let json
    try{ json = JSON.parse(data) }catch(e){ return res.status(500).json({error:'parse error'}) }
    if (!Array.isArray(json)) return res.status(500).json({error:'invalid data'})
    if (type === 'csv'){
      // simple CSV: id,type,dia,length,count,unitWeight,totalKg
      const rows = [['id','type','dia','length','count','unitWeight','totalKg']]
      json.forEach(line=> rows.push([line.id||'', line.type||'', line.dia||'', line.length||'', line.count||'', line.unitWeight||'', line.totalKg||'']))
      const csv = rows.map(r=> r.map(cell=> String(cell).replace(/"/g,'""')).map(c=> '"'+c+'"').join(',')).join('\n')
      res.setHeader('Content-Type','text/csv')
      res.setHeader('Content-Disposition','attachment; filename=bom.csv')
      return res.send(csv)
    }
    // default: json download
    res.setHeader('Content-Type','application/json')
    res.setHeader('Content-Disposition','attachment; filename=bom.json')
    res.send(JSON.stringify(json, null, 2))
  })
})

const port = process.env.PORT || 4000
app.listen(port, ()=>console.log(`OSSM backend running on ${port}`))
