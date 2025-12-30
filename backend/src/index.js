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
    res.json(JSON.parse(data))
  })
})

app.get('/api/detailing', (req, res) => {
  const p = path.join(DATA_DIR, 'detailing_rules.json')
  fs.readFile(p, 'utf8', (err, data)=>{
    if (err) return res.status(500).json({error: 'read error'})
    res.json(JSON.parse(data))
  })
})

app.get('/api/aisc', (req, res) => {
  const p = path.join(DATA_DIR, 'aisc_v16.json')
  fs.readFile(p, 'utf8', (err, data)=>{
    if (err) return res.status(500).json({error: 'read error'})
    res.json(JSON.parse(data))
  })
})

const port = process.env.PORT || 4000
app.listen(port, ()=>console.log(`OSSM backend running on ${port}`))
