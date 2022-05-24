#!/usr/bin/env node
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const redis = require('redis');
let argv = require('minimist')(process.argv.slice(2));

const client = redis.createClient({
  url: 'redis://localhost:6379/10'
});
client.on('error', (err) => console.log('redis client error', err));
client.on('ready', function() {
  console.log("redis is ready")
});

const app = express();
const port = argv.port || 8888;

const MAX_LENGTH = 100000000;

app.use(cors());
app.use(express.json());
app.use(compression());

app.get('/sequence/region/:system/:location', get_sequence);

//${gene.system_name}/${gene.location.region}:${from}..${to}:${gene.location.strand}
const location_re = /(.+):(\d+)\.\.(\d+):(.*)/;

function get_sequence(req, res) {
  // parse the region, from, to and strand from location
  // determine which 100mb chunk(s) need to be accessed
  // for each one, call GETRANGE 
  // assemble result into json response
  const system = req.params.system;
  let [loc,region,start,end,strand] = req.params.location.match(location_re);
  start = +start;
  end = +end;
  if (start > end) {
    res.send({
      error: `Cannot request a slice whose start is greater than its end. Start: ${start}. End: ${end}`
    })
  }
  const qlen = end-start+1;
  if (qlen > 10000000) {
    res.send({
      error: `${qlen} is greater than the maximum allowed length of 10000000. Request smaller regions of sequence`
    })
  }
  const result = {
    molecule: "dna",
    query: req.params.location,
    id: req.params.location,
    seq: ''
  };
  function getSubseq(system,region,start,end) {
    const startBin = Math.floor(start/MAX_LENGTH);
    const endBin = Math.floor(end/MAX_LENGTH);
    const offset = startBin * MAX_LENGTH;
    client.getrange(`${system}:${region}:${startBin}`, start - offset, end - offset, function (err, seq) {
      if (err) {
        res.send({
          error: `Invalid location ${result.query}`
        })
        throw err;
      }
      result.seq += seq;
      if (startBin < endBin) {
        getSubseq(system, region, offset + MAX_LENGTH, end);
      }
      else {
        if (strand === "-1") {
          result.seq = reverse_complement(result.seq);
        }
        res.send(result);
      }
    })
  }
  getSubseq(system,region,start-1,end-1); // because redis getrange is 0 based
}

const complement = {
  A:'T',
  T:'A',
  C:'G',
  G:'C'
};

function reverse_complement(seq) {
  let rc = []
  seq.split('').forEach(base => {
    rc.unshift(complement[base] || base)
  });
  return rc.join('');
}

app.listen(port, () => console.log(`Example app listening at http://localhost:${port}`));
  
