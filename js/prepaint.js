// Runs before the stylesheet paints: applies the saved theme so the first frame already has the right colours.
try{var p=JSON.parse(localStorage.getItem('logi-prefs')||'{}'),d=document.documentElement;d.dataset.palette=p.palette||'brass';d.dataset.scheme=p.scheme==='light'||p.scheme==='dark'?p.scheme:(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');}catch(e){}
