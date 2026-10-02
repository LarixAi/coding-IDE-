const test = require("node:test");
const assert = require("node:assert/strict");
const { createProjectBrain, addRequirement, addDecision, addVerifiedLesson, rememberFile, invalidateChangedFiles, retrieveProjectContext, projectBrainText } = require("../project-brain");

test("identity anchors later tasks and requirements persist", () => {
  const brain = createProjectBrain({root:"dealer", originalPrompt:"Build me a dealership website", identity:{domain:"automotive dealership",purpose:"Automotive dealership website"}}, "2026-10-02T12:00:00Z");
  addRequirement(brain,{text:"Customers can browse vehicles",status:"confirmed"});
  const ctx = retrieveProjectContext(brain,"redesign homepage");
  assert.equal(ctx.identity.purpose,"Automotive dealership website");
  assert.equal(ctx.requirements[0].text,"Customers can browse vehicles");
});
test("AI suggestions stay proposed until confirmed", () => {
  const brain=createProjectBrain({goal:"Dealership website"});
  addRequirement(brain,{text:"Customer accounts",status:"proposed",source:"model"});
  assert.equal(brain.requirements[0].status,"proposed");
});
test("only verified lessons become durable lessons", () => {
  const brain=createProjectBrain({goal:"Dealership website"});
  addVerifiedLesson(brain,{text:"Use route X",verified:false});
  addVerifiedLesson(brain,{text:"Route Y passes tests",verified:true,evidence:["test"]});
  assert.equal(brain.lessons.length,1);
  assert.equal(brain.lessons[0].text,"Route Y passes tests");
});
test("changed file hashes invalidate stale knowledge", () => {
  const brain=createProjectBrain({goal:"Dealership website"});
  rememberFile(brain,{path:"src/auth.js",hash:"old",summary:"Handles auth"});
  invalidateChangedFiles(brain,{"src/auth.js":"new"});
  assert.equal(brain.files["src/auth.js"].status,"stale");
  assert.equal(retrieveProjectContext(brain,"auth").files.length,0);
});
test("task retrieval prefers relevant project knowledge", () => {
  const brain=createProjectBrain({goal:"Dealership website"});
  addRequirement(brain,{text:"Customers can book test drives",tags:["booking"]});
  addRequirement(brain,{text:"Homepage has featured vehicles",tags:["homepage"]});
  addDecision(brain,{title:"Booking slots are managed by staff",tags:["booking"]});
  const ctx=retrieveProjectContext(brain,"change booking confirmation",{limitPerType:1});
  assert.match(ctx.requirements[0].text,/book test drives/);
  assert.match(projectBrainText(ctx),/Project identity:/);
});
