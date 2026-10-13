(async()=>{
  const checks=[];
  const check=(ok,message)=>{if(!ok)throw Error(message);checks.push(message);};
  try {
    await window.gacchankoReady;
    const P=window.gacchanko;
    check(window.gacchankoHost.platform==='tauri','Real Tauri bridge active');
    check(P.graph.nodes.length>1 && document.querySelectorAll('.node').length===P.graph.nodes.length,'Initial Rust snapshot renders nodes');
    const edgeID=P.graph.edges[0].id;
    P.mutate(()=>{P.graph.edges[0].intent+=' Native WebView integration test.';});
    await P.save(false);
    const reopened=await P.call('reload');P.cleanState(reopened);
    check(reopened.project.edges[0].intent.includes('Native WebView'),'Save and reopen through IPC');
    await P.call('testReport');await P.poll();
    check(P.status(edgeID)==='verified','Report polling through Rust history');
    P.select('edge',edgeID);
    check(document.querySelector('.status-card.verified'),'Verified report visible');
    P.mutate(()=>{P.graph.edges[0].intent+=' Requirement changed.';});await P.save(false);await P.poll();
    check(P.status(edgeID)==='stale','Changed requirements invalidate report');
    const prompt=await P.call('copyPrompt',{edgeID});
    check(prompt.includes(edgeID)&&prompt.includes('AGENT_BRIEF.md'),'Native clipboard handoff');
    await P.changeLanguage('en');
    check(document.documentElement.lang==='en','Language switch and native menu command');
    await P.changeLanguage('ja');
    const state=await P.call('state');
    const detail=await P.call('historyDetail',{id:state.history.head});
    check(detail.diff.includes('Requirement changed'),'History diff through IPC');
    await P.call('testFinish',{ok:true,checks});
  } catch(error) {
    await window.gacchankoHost.request('testFinish',{ok:false,checks,error:error.stack||String(error)});
  }
})();
