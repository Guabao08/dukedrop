import test from 'node:test';import assert from 'node:assert/strict';import {calculateAmount,buildNote,validateOrder,venmoLinks} from '../app.js';
test('tier amount',()=>assert.equal(calculateAmount('express','M',3),14.97));
test('note contains required fields',()=>assert.equal(buildNote({dorm:'Randolph',room:'214',size:'S',tracking:'TBA 1',carrier:'Amazon'}),'DukeDrop | Dorm: Randolph | Room: 214 | Size: S | Tracking: TBA 1 | Carrier: Amazon'));
test('validation requires all fields',()=>assert.equal(validateOrder({service:'express',size:'S',quantity:1,dorm:'',room:'',tracking:'',carrier:''}).valid,false));
test('Venmo links encode note and amount',()=>{const x=venmoLinks({service:'pickup',size:'L',quantity:2,dorm:'Few Quad',room:'4 A',tracking:'1&2',carrier:'UPS'});assert.match(x.deepLink,/venmo:\/\/paycharge\?/);assert.match(x.deepLink,/amount=3.98/);assert.match(x.deepLink,/note=DukeDrop\+%7C/);assert.equal(new URL(x.webLink).searchParams.get('note'),x.note)});
