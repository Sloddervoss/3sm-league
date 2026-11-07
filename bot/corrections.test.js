import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beslisRollback, publiceerCorrectie } from './corrections.js';

// Registreert de volgorde van alle bijwerkingen, zodat de test de ordening kan
// bewijzen en niet alleen het eindresultaat.
function harnas({ sendResultaat = { id: 'nieuw' }, markeerUitkomst = 'opgeslagen' } = {}) {
  const gebeurtenissen = [];
  return {
    gebeurtenissen,
    args: {
      origineelMessageId: 'origineel',
      stuur: async () => {
        gebeurtenissen.push('stuur');
        return sendResultaat;
      },
      verwijder: async (doel) => {
        gebeurtenissen.push(`verwijder:${doel === 'origineel' ? 'origineel' : doel.id}`);
      },
      markeer: async () => {
        gebeurtenissen.push('markeer');
        return markeerUitkomst;
      },
    },
  };
}

test('origineel verdwijnt pas nadat het vervangende bericht is vastgelegd', async () => {
  const h = harnas();
  const uitkomst = await publiceerCorrectie(h.args);

  assert.equal(uitkomst, 'verstuurd');
  assert.deepEqual(h.gebeurtenissen, ['stuur', 'markeer', 'verwijder:origineel']);
});

test('mislukt opslaan: nieuwe bericht weg, origineel blijft staan', async () => {
  const h = harnas({ markeerUitkomst: 'mislukt' });
  const uitkomst = await publiceerCorrectie(h.args);

  assert.equal(uitkomst, 'opslaan_mislukt');
  assert.deepEqual(h.gebeurtenissen, ['stuur', 'markeer', 'verwijder:nieuw']);
  assert.ok(!h.gebeurtenissen.includes('verwijder:origineel'));
});

test('mislukte send raakt niets aan', async () => {
  const h = harnas({ sendResultaat: null });
  const uitkomst = await publiceerCorrectie(h.args);

  assert.equal(uitkomst, 'send_mislukt');
  assert.deepEqual(h.gebeurtenissen, ['stuur']);
});

test('dubbel: ons eigen bericht wordt opgeruimd, origineel blijft', async () => {
  const h = harnas({ markeerUitkomst: 'dubbel' });
  const uitkomst = await publiceerCorrectie(h.args);

  assert.equal(uitkomst, 'dubbel');
  assert.deepEqual(h.gebeurtenissen, ['stuur', 'markeer', 'verwijder:nieuw']);
});

test('een mislukte opruiming na succes maakt de publicatie niet ongedaan', async () => {
  const h = harnas();
  h.args.verwijder = async (doel) => {
    h.gebeurtenissen.push(`verwijder:${doel === 'origineel' ? 'origineel' : doel.id}`);
    throw new Error('Missing Permissions');
  };

  const uitkomst = await publiceerCorrectie(h.args);
  assert.equal(uitkomst, 'verstuurd');
});

test('een gecommitte maar onbevestigde schrijfactie houdt het bericht', () => {
  assert.equal(beslisRollback({ vlagGezet: true, opgeslagenMessageId: 'm1', onsMessageId: 'm1' }), 'behouden');
  assert.equal(beslisRollback({ vlagGezet: true }), 'behouden');
  assert.equal(beslisRollback({ vlagGezet: false, opgeslagenMessageId: 'm1', onsMessageId: 'm1' }), 'verwijderen');
  assert.equal(beslisRollback({ vlagGezet: true, opgeslagenMessageId: 'ander', onsMessageId: 'm1' }), 'verwijderen');
});
