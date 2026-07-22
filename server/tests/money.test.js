import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  kwachaToNgwee,
  ngweeToKwacha,
  formatKwacha,
  integerToWords,
  amountInWords,
} from '../src/money.js';

test('kwachaToNgwee converts and rounds correctly', () => {
  assert.equal(kwachaToNgwee(1500), 150000);
  assert.equal(kwachaToNgwee('1,500'), 150000);
  assert.equal(kwachaToNgwee(1500.5), 150050);
  assert.equal(kwachaToNgwee(0.1 + 0.2), 30); // no float drift -> 0.30 -> 30 ngwee
});

test('kwachaToNgwee rejects invalid input', () => {
  assert.throws(() => kwachaToNgwee(''));
  assert.throws(() => kwachaToNgwee('abc'));
  assert.throws(() => kwachaToNgwee(-5));
});

test('ngweeToKwacha and formatKwacha', () => {
  assert.equal(ngweeToKwacha(150000), 1500);
  assert.equal(formatKwacha(150000), 'K 1,500'); // whole Kwacha -> no decimals
  assert.equal(formatKwacha(150050), 'K 1,500.50'); // ngwee remainder shown
  assert.equal(formatKwacha(0), 'K 0');
  assert.equal(formatKwacha(2000000), 'K 20,000');
});

test('integerToWords', () => {
  assert.equal(integerToWords(0), 'zero');
  assert.equal(integerToWords(19), 'nineteen');
  assert.equal(integerToWords(21), 'twenty-one');
  assert.equal(integerToWords(100), 'one hundred');
  assert.equal(integerToWords(1500), 'one thousand five hundred');
  assert.equal(integerToWords(1234567), 'one million two hundred thirty-four thousand five hundred sixty-seven');
});

test('amountInWords for Kwacha and ngwee remainder', () => {
  assert.equal(amountInWords(150000), 'One thousand five hundred Kwacha only');
  assert.equal(amountInWords(150050), 'One thousand five hundred Kwacha and fifty Ngwee');
  assert.equal(amountInWords(100), 'One Kwacha only');
  assert.equal(amountInWords(0), 'Zero Kwacha only');
});
