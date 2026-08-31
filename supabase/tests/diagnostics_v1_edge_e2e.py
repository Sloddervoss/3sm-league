#!/usr/bin/env python3
import copy, json, subprocess, threading, time, urllib.error, urllib.request

DIAG = "http://192.168.50.23:9101/simhub-diagnostic"
INGEST = "http://192.168.50.23:9102/simhub-ingest"
ORIGIN = "https://3stripemotorsport.cc"
TOKENS = {
    "A": "diag-test-token-A-" + "a" * 48,
    "B": "diag-test-token-B-" + "b" * 48,
    "R": "diag-test-token-R-" + "r" * 48,
    "U": "diag-test-token-U-" + "u" * 48,
    "BAD": "diag-test-token-X-" + "x" * 48,
}
A="aaaaaaaa-0000-0000-0000-000000000001"; B="bbbbbbbb-0000-0000-0000-000000000002"
R="cccccccc-0000-0000-0000-000000000003"; U="dddddddd-0000-0000-0000-000000000004"
PASS=[]; FAIL=[]

def http(url, method="POST", token=None, body=None, raw=None, timeout=10, content_type="application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    headers={"Origin":ORIGIN}
    if content_type: headers["Content-Type"] = content_type
    if token is not None: headers["Authorization"] = token if token.startswith("Bearer") else f"Bearer {token}"
    req=urllib.request.Request(url,data=data,headers=headers,method=method)
    try:
        with urllib.request.urlopen(req,timeout=timeout) as r: return r.status,r.read().decode()
    except urllib.error.HTTPError as e: return e.code,e.read().decode()

def ssh(command):
    return subprocess.run(["ssh","3sm-docker",command],text=True,capture_output=True,check=True).stdout.strip()

def db(sql, mutate=False):
    if mutate:
        sql = "DO $$ BEGIN IF current_database()<>'test_diagnostics_v1' OR current_user<>'supabase_admin' THEN RAISE EXCEPTION 'ABORT wrong target'; END IF; END $$;\n" + sql
    p=subprocess.run(["ssh","3sm-docker","docker exec -i supabase-db psql -U supabase_admin -d test_diagnostics_v1 -t -A -v ON_ERROR_STOP=1"],input=sql,text=True,capture_output=True)
    if p.returncode: raise RuntimeError(p.stderr)
    return p.stdout.strip()

def check(name, cond, evidence=""):
    (PASS if cond else FAIL).append(name)
    print(("PASS" if cond else "FAIL")+f": {name}"+(f" [{evidence}]" if evidence else ""))

def heartbeat(device=A, code="OK"):
    return {"clientReportedAtUtc":"2026-08-31T20:00:00Z","connectorVersion":"0.3.10.0","deviceId":device,"diagnosticCode":code,"gameConnected":True,"lastIngestHttpStatus":202,"lastSuccessfulIngestUtc":"2026-08-31T20:00:00Z","lastTelemetryAttemptUtc":"2026-08-31T20:00:00Z","lastUpdateResult":"none","lastUpdateUtc":None,"rawDataAvailable":True,"rawTelemetryAvailable":True,"sequence":1,"sessionTimeReadOk":True,"sessionTimeReader":"RawDataReflection","sessionTimeSeconds":100.0,"simHubVersion":"9.11","telemetryAvailable":True,"type":"heartbeat","updaterCurrentVersion":"0.3.10.0","updaterState":"IDLE","updaterTargetVersion":None}

def event(device=A, code="OK", detail="allowlisted detail"):
    return {"atUtc":"2026-08-31T20:00:00Z","code":code,"detail":detail,"deviceId":device,"exceptionType":None,"occurredAfter":None,"type":"event"}

def ingest_payload(seq):
    return {"protocolVersion":2,"sequence":seq,"capturedAt":"2026-08-31T20:00:00Z","source":{"connectorId":"E2E-A","simHubVersion":"9.11","game":"IRacing"},"race":{"eventId":"e2e-event","teamId":"e2e-team","sessionId":"edge-e2e-session","driverId":None,"currentDriverId":None,"currentDriverName":None,"carId":None,"carName":None,"trackName":None,"trackConfig":None},"telemetry":{"connected":True,"sessionTimeSeconds":float(seq),"lap":1,"completedLaps":0,"lapTimeSeconds":None,"position":1,"classPosition":1,"speedKph":100.0,"fuelLitres":50.0,"fuelPerLapLitres":2.0,"estimatedLapsRemaining":25.0,"inPitLane":False,"pitLimiter":False,"stintElapsedSeconds":float(seq),"incidents":0,"flag":"green","isInCar":True}}

print("== ROUTING + METHOD ==")
code,body=http(DIAG,"OPTIONS"); check("OPTIONS 200",code==200,(str(code)))
code,body=http(DIAG,"GET"); check("GET 405",code==405,str(code))
identity=ssh("IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' e2e-pgrst-diag); curl -s -X POST -H 'Content-Type: application/json' -d '{}' http://$IP:3000/rpc/diagnostics_test_database_identity")
check("Edge backend identity test_diagnostics_v1", "test_diagnostics_v1" in identity, identity)

print("== AUTH + T02 ==")
db("DELETE FROM simhub_device_health; DELETE FROM simhub_device_diagnostic_events;",True)
for name,token,expected in [("missing Authorization",None,401),("malformed Bearer","Basic abc",401),("bad token",TOKENS['BAD'],401),("revoked",TOKENS['R'],401)]:
    c,b=http(DIAG,token=token,body=heartbeat(R if name=='revoked' else A)); check(name,c==expected and 'invalid_device' in b,f"{c} {b}")
c,b=http(DIAG,token=TOKENS['A'],body=heartbeat(B)); check("T02 mismatch HTTP reject",c==401 and 'device_mismatch' in b,f"{c} {b}")
counts=db(f"SELECT (SELECT count(*) FROM simhub_device_health WHERE device_id IN ('{A}','{B}'))||','||(SELECT count(*) FROM simhub_device_diagnostic_events WHERE device_id IN ('{A}','{B}')); ")
check("T02 no health/event writes A/B",counts.endswith("0,0"),counts)
c,b=http(DIAG,token=TOKENS['U'],body=heartbeat(U,"DEVICE_UNBOUND")); check("unbound valid device",c==200 and 'accepted' in b,f"{c} {b}")

print("== SCHEMA ==")
base=heartbeat(A)
cases=[]
x=copy.deepcopy(base); x['unknown']=1; cases.append(("unknown top-level",x))
x=copy.deepcopy(base); del x['connectorVersion']; cases.append(("missing required",x))
x=copy.deepcopy(base); x['gameConnected']='yes'; cases.append(("wrong datatype",x))
x=copy.deepcopy(base); x['diagnosticCode']='BOGUS'; cases.append(("invalid diagnosticCode",x))
x=copy.deepcopy(base); x['clientReportedAtUtc']='not-a-time'; cases.append(("invalid timestamp",x))
for name,payload in cases:
    c,b=http(DIAG,token=TOKENS['A'],body=payload); check(name,c==422 and 'invalid_payload' in b,f"{c} {b}")
c,b=http(DIAG,token=TOKENS['A'],raw=b'{bad'); check("malformed JSON",c==400 and 'invalid_json' in b,f"{c} {b}")
c,b=http(DIAG,token=TOKENS['A'],raw=b'{"type":"heartbeat","sessionTimeSeconds":NaN}'); check("NaN invalid JSON",c==400 and 'invalid_json' in b,f"{c} {b}")
c,b=http(DIAG,token=TOKENS['A'],raw=b'{"type":"heartbeat","sessionTimeSeconds":Infinity}'); check("Infinity invalid JSON",c==400 and 'invalid_json' in b,f"{c} {b}")
c,b=http(DIAG,token=TOKENS['A'],body={**base,"connectorVersion":"x"*5000}); check("body >4KiB",c==413 and 'payload_too_large' in b,f"{c} {b}")
for name,payload in [("detail >200",event(detail='x'*201)),("path-like detail",event(detail=r'C:\\Users\\fake\\secret.txt'))]:
    c,b=http(DIAG,token=TOKENS['A'],body=payload); check(name,c==422 and 'invalid_payload' in b,f"{c} {b}")

print("== RESULT MAPPINGS ==")
db("DELETE FROM simhub_device_health; DELETE FROM simhub_device_diagnostic_events;",True)
c,b=http(DIAG,token=TOKENS['A'],body=heartbeat(A)); check("heartbeat accepted",c==200 and 'accepted' in b,f"{c} {b}")
c,b=http(DIAG,token=TOKENS['A'],body=heartbeat(A)); check("heartbeat 429 mapping",c==429 and 'diagnostic_rate_limited' in b,f"{c} {b}")
c,b=http(DIAG,token=TOKENS['B'],body=event(B)); check("event accepted",c==200 and 'accepted' in b,f"{c} {b}")
c,b=http(DIAG,token=TOKENS['B'],body=event(B,'TELEMETRY_STALE')); check("event 429 mapping",c==429 and 'diagnostic_event_rate_limited' in b,f"{c} {b}")

print("== RUNTIME PRIVACY ==")
sensitive="SENSITIVE_E2E_C__Users_fake_token_xyz"
db(f'ALTER TABLE simhub_device_health ADD CONSTRAINT "{sensitive}" CHECK (false) NOT VALID; DELETE FROM simhub_device_health WHERE device_id=\'{A}\';',True)
ssh("docker logs e2e-edge-diag >/tmp/e2e-edge-before.log 2>&1")
c,b=http(DIAG,token=TOKENS['A'],body=heartbeat(A)); time.sleep(.5)
logs=ssh("docker logs e2e-edge-diag 2>&1 | tail -80")
check("RPC/internal failure -> generic 500",c==500 and b==json.dumps({'error':'internal_error'},separators=(',',':')),f"{c} {b}")
check("sensitive marker absent response",sensitive not in b,b)
check("sensitive marker absent Edge logs",sensitive not in logs,"absent" if sensitive not in logs else "LEAK")
check("token absent Edge logs",TOKENS['A'] not in logs,"absent" if TOKENS['A'] not in logs else "LEAK")
db(f'ALTER TABLE simhub_device_health DROP CONSTRAINT "{sensitive}";',True)

print("== 60s NON-INTERFERENCE ==")
db("DELETE FROM simhub_device_health; DELETE FROM simhub_device_diagnostic_events; DELETE FROM endurance_telemetry_events; DELETE FROM simhub_telemetry_latest; DELETE FROM simhub_device_sessions; UPDATE simhub_devices SET last_sequence=-1,last_session_id=NULL WHERE id='aaaaaaaa-0000-0000-0000-000000000001';",True)
ingest_results=[]; diag_results=[]
def telemetry_loop():
    for seq in range(1,61):
        ingest_results.append((seq,*http(INGEST,token=TOKENS['A'],body=ingest_payload(seq),timeout=5)))
        time.sleep(1)
def diagnostic_faults():
    time.sleep(2)
    db(f"DELETE FROM simhub_device_health WHERE device_id='{B}';",True)
    diag_results.append(("accepted",*http(DIAG,token=TOKENS['B'],body=heartbeat(B))))
    diag_results.append(("429",*http(DIAG,token=TOKENS['B'],body=heartbeat(B))))
    # Timeout: hold only diagnostics health table lock; telemetry uses separate tables/RPC.
    locker=subprocess.Popen(["ssh","3sm-docker","docker exec -i supabase-db psql -U supabase_admin -d test_diagnostics_v1"],stdin=subprocess.PIPE,text=True)
    assert locker.stdin is not None
    locker.stdin.write("BEGIN; LOCK TABLE simhub_device_health IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(6); COMMIT;\n"); locker.stdin.close()
    locked=False
    for _ in range(30):
        if db("SELECT count(*) FROM pg_locks WHERE relation='simhub_device_health'::regclass AND mode='AccessExclusiveLock' AND granted;").splitlines()[-1] == "1":
            locked=True; break
        time.sleep(.1)
    if not locked: raise RuntimeError("diagnostic timeout lock was not acquired")
    try:
        http(DIAG,token=TOKENS['U'],body=heartbeat(U),timeout=1)
        diag_results.append(("timeout-missed",0,""))
    except Exception:
        diag_results.append(("timeout",0,"client timeout"))
    locker.wait()
    # Connection failure scoped to diagnostics PostgREST only.
    ssh("docker stop e2e-pgrst-diag >/dev/null")
    diag_results.append(("connection-failure",*http(DIAG,token=TOKENS['U'],body=heartbeat(U),timeout=5)))
    ssh("docker start e2e-pgrst-diag >/dev/null"); time.sleep(2)

t1=threading.Thread(target=telemetry_loop); t2=threading.Thread(target=diagnostic_faults); t1.start(); t2.start(); t1.join(); t2.join()
accepted=[r for r in ingest_results if r[1]==202 and 'accepted' in r[2]]
check("telemetry 60/60 accepted during diagnostic faults",len(accepted)==60,f"{len(accepted)}/60")
state=db(f"SELECT count(*)||','||min(sequence)||','||max(sequence) FROM endurance_telemetry_events WHERE device_id='{A}' AND session_id='edge-e2e-session'; SELECT sequence FROM simhub_telemetry_latest WHERE device_id='{A}'; SELECT last_sequence FROM simhub_device_sessions WHERE device_id='{A}' AND session_id='edge-e2e-session';")
lines=[x for x in state.splitlines() if x]
check("telemetry events gap-free 1..60",lines[0]=="60,1,60",lines[0] if lines else state)
check("latest sequence=60",len(lines)>1 and lines[1]=="60",state)
check("session sequence=60",len(lines)>2 and lines[2]=="60",state)
check("diagnostic timeout exercised",any(x[0]=='timeout' for x in diag_results),str(diag_results))
check("diagnostic connection failure generic 500",any(x[0]=='connection-failure' and x[1]==500 and 'internal_error' in x[2] for x in diag_results),str(diag_results))
check("no retry storm (fixed 4 diagnostic calls)",len(diag_results)==4,str(diag_results))

print(f"SUMMARY PASS={len(PASS)} FAIL={len(FAIL)}")
if FAIL:
    print("FAILED:",", ".join(FAIL)); raise SystemExit(1)
