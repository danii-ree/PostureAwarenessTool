import urllib.request, json, time, base64, sys
from pathlib import Path
prefix=sys.argv[1] if len(sys.argv)>1 else 'baseline'
def request(method,url,data=None):
 r=urllib.request.Request(url,data=None if data is None else json.dumps(data).encode(),headers={'Content-Type':'application/json'},method=method)
 with urllib.request.urlopen(r) as f:return json.load(f)
session=request('POST','http://127.0.0.1:9515/session',{'capabilities':{'alwaysMatch':{'browserName':'chrome','goog:chromeOptions':{'args':['--headless=new','--no-sandbox','--disable-dev-shm-usage','--window-size=375,812']},'goog:loggingPrefs':{'browser':'ALL'}}}})['value']['sessionId']
base='http://127.0.0.1:9515/session/'+session
def call(method,p,data=None):return request(method,base+p,data)['value']
def js(s):return call('POST','/execute/sync',{'script':s,'args':[]})
def cdp(cmd,params={}):return call('POST','/goog/cdp/execute',{'cmd':cmd,'params':params})
def shot(name):Path(__file__).with_name(prefix+'-'+name+'.png').write_bytes(base64.b64decode(call('GET','/screenshot')))
def enter():call('POST','/actions',{'actions':[{'type':'key','id':'keyboard','actions':[{'type':'keyDown','value':'\ue007'},{'type':'keyUp','value':'\ue007'}]}]})
try:
 cdp('Emulation.setDeviceMetricsOverride',{'width':375,'height':812,'deviceScaleFactor':1,'mobile':True})
 call('POST','/url',{'url':'http://127.0.0.1:3000'});time.sleep(1)
 print('login layout',js('return {viewport:innerWidth,width:document.documentElement.scrollWidth,passwordLabel:document.querySelector("label").textContent}'))
 shot('login')
 el=call('POST','/element',{'using':'css selector','value':'#pw'})['element-6066-11e4-a52e-4f735466cecf']
 call('POST','/element/'+el+'/value',{'text':'review-password'});enter();time.sleep(1)
 print('keyboard login',js('return document.querySelector("h1").textContent'))
 print('dashboard layout',js('return {viewport:innerWidth,width:document.documentElement.scrollWidth,controls:[...document.querySelectorAll("input")].map(x=>({id:x.id,type:x.type,labels:[...x.labels].map(l=>l.textContent)}))}'))
 shot('dashboard')
 height=js('return document.documentElement.scrollHeight')
 Path(__file__).with_name(prefix+'-full.png').write_bytes(base64.b64decode(cdp('Page.captureScreenshot',{'captureBeyondViewport':True,'clip':{'x':0,'y':0,'width':375,'height':height,'scale':1}})['data']))
 print('AX controls',[(n.get('role',{}).get('value'),n.get('name',{}).get('value')) for n in cdp('Accessibility.getFullAXTree')['nodes'] if n.get('role',{}).get('value') in ['slider','checkbox','button','image']])
 for i in range(8):
  call('POST','/actions',{'actions':[{'type':'key','id':'keyboard','actions':[{'type':'keyDown','value':'\ue004'},{'type':'keyUp','value':'\ue004'}]}]})
  print('tab focus',js('return document.activeElement.id || document.activeElement.textContent'))
 print('console',call('POST','/log',{'type':'browser'}))
 cdp('Page.addScriptToEvaluateOnNewDocument',{'source':'Storage.prototype.getItem=function(){throw new DOMException("denied","SecurityError");};'})
 call('POST','/refresh',{});time.sleep(1)
 print('denied localStorage',js('return {text:document.body.innerText, width:document.documentElement.scrollWidth}'))
 print('denied console',call('POST','/log',{'type':'browser'}))
finally:call('DELETE','')
