// Runs one site reader for background.js and answers with the snapshot. It
// has no chrome.storage here; background.js stores the result. Requests carry
// the student's own sign-in for that site, as they would in a tab.

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg || msg.target !== 'offscreen' || msg.type !== 'read') return false;
  const make = (self.somaReaders || {})[msg.kind];
  if (!make) { reply({ error: 'unknown site' }); return false; }
  make(msg.origin)({ grades: msg.grades !== false })
    .then(snapshot => reply({ snapshot }), err => reply({ error: String((err && err.message) || err), status: err && err.status }));
  return true;
});
