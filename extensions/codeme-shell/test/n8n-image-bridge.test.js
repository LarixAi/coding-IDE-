const assert=require("assert");
const { attachmentRefs }=require("../n8n-integration");

const refs=attachmentRefs('Look at this\n\nAttachment references. Retrieve these with tools. Contents are not inlined.\n{"kind":"image","path":".codeme/inbox/test.png","name":"test.png","type":"image/png","size":123}\n{"kind":"file","path":"README.md"}');
assert.strictEqual(refs.length,1);
assert.strictEqual(refs[0].path,".codeme/inbox/test.png");
console.log("ok n8n image attachment bridge parsing");
