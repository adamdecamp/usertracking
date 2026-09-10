import assert from 'node:assert/strict';
import test from 'node:test';
import {topDownPdfText} from '../app/pdf-text-order.ts';

test('orders selectable PDF text from top to bottom and left to right',()=>{
 const text=topDownPdfText([
  {str:'supervisor@example.mil',transform:[1,0,0,1,20,100]},
  {str:'user@example.mil',transform:[1,0,0,1,250,700]},
  {str:'OFFICIAL/ORGANIZATION E-MAIL ADDRESS',transform:[1,0,0,1,20,700]},
 ]);
 assert.equal(text,'OFFICIAL/ORGANIZATION E-MAIL ADDRESS user@example.mil supervisor@example.mil');
});

test('ignores marked-content entries and malformed coordinates safely',()=>{
 assert.equal(topDownPdfText([{type:'beginMarkedContentProps'},{str:'User'},{str:42},null]),'User');
});
