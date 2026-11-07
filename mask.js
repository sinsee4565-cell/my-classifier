// mask.js — 이름 · 전화번호 · 사번을 [이름] [전화번호] [사번] 으로 바꾼다.
// 분류와 전송은 모두 가린 문장으로 한다.
// 이름은 사전 없이 모양으로 찾는다. 놓치거나 잘못 가리는 경우가 있을 수 있다.
(function () {
  const H = "[가-힣]";
  const isNameLike = (w) => w.length >= 2 && w.length <= 3 && SURNAMES.includes(w[0]) &&
    [...w.slice(1)].every((ch) => GIVEN.includes(ch));
  const NO_H_BEFORE = "(?<![가-힣])";
  const NO_H_AFTER = "(?![가-힣])";

  // 흔한 한국 성씨
  const SURNAMES =
    "김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예경봉부가복태목형피두감음빈동온호범좌시";
  // 이름(성 뒤 두 글자)에 흔히 쓰는 글자
  const GIVEN =
    "민준서연지우현수은영진호하윤도유아예시주원재성혁훈희경정미혜선동석태상철승빈나리율채다소인한규범찬건형욱종근기용광남숙순자옥애란화별솔결겸린효신환완국명병열웅택길덕봉식중창홍" +
    "세계늘름라가흥엽강람슬보비루담온새해률빛운필학후휘본솜래구안";
  // 두 글자 성씨
  const SURNAMES2 = ["남궁", "황보", "제갈", "선우", "독고"];
  // 이름 셋째 글자로는 받지 않는 글자 (조사 · 흔한 낱말 끝과 겹침)
  const NOT_LAST = "는가을를도의이요로본해";
  // 직함 · 호칭
  const TITLES = ["본부장", "팀장", "부장", "차장", "과장", "대리", "주임", "사원", "반장", "실장", "이사", "대표",
    "매니저", "담당자", "고객", "기사", "선생", "사장", "회원", "선배", "후배"];
  // 성씨로 시작하지만 이름이 아닌 흔한 낱말
  const NOT_NAMES = ["신입", "신규", "정규", "전체", "고객", "기사", "담당", "해당", "이번", "주말", "공급",
    "정수기", "주유소", "전화기", "이상은",
    // 호칭 없는 이름을 넓게 잡으면서 걸리는 흔한 낱말
    "주세요", "하세요", "하나요", "주문한", "주문서", "주문은", "전산상", "기준표", "예정인", "오늘은",
    "안전화", "신청은", "신청서", "정산서", "이상한", "임시로", "전화로", "이번엔", "정상인", "확인한",
    "안내서", "주간은", "조회한", "진행한", "전달한", "연락한", "정리한", "준비한", "변경한", "오전은",
    "오후는", "장비는", "전부는", "정도는", "이유는", "이번은", "배송", "기록지", "원산지", "경보기"];
  // 씨 · 님 앞에 붙지만 이름이 아닌 말
  const NOT_BEFORE_SUFFIX = ["아저", "아가", "마음", "하느", "임금", "선생", "사장", "고객", "기사", "회원", "손"];

  const given3 = "[" + GIVEN.replace(new RegExp("[" + NOT_LAST + "]", "g"), "") + "]";
  const PARTICLES = "(?:에게서|에게|한테|께서|이랑|이가|이는|이를|이도|이의|이와|이|가|은|는|을|를|께|의|도|와|과|랑|씨|님)";

  const PHONE = /(\+82[-.\s]?)?0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/g;
  const EMP_ID = /(사번\s*[:：]?\s*)[A-Za-z]*\d[A-Za-z0-9-]*/g;
  // 1) 이름 + 직함:  김민준 대리, 이준서 고객님
  const NAME_TITLE = new RegExp(
    NO_H_BEFORE + "([" + SURNAMES + "][" + GIVEN + "]{1,2})(?=\\s?(?:" + TITLES.join("|") + "|씨))", "g");
  // 2) 이름 + 씨/님:  민준씨, 서연 님, 하은님께
  const NAME_SUFFIX = new RegExp(NO_H_BEFORE + "(" + H + "{2,4})(?=\\s?(?:씨|님))", "g");
  // 3) 호칭 없는 세 글자 이름:  김민준이, 정하은한테
  const NAME_BARE = new RegExp(
    NO_H_BEFORE + "((?:" + SURNAMES2.join("|") + ")[" + GIVEN + "]{1,2}|[" + SURNAMES + "][" + GIVEN + "]" + given3 + ")(?=" +
    PARTICLES + "?" + NO_H_AFTER + ")", "g");

  const MARK = "\u0001";
  const isNotName = (w) => NOT_NAMES.includes(w);

  function maskSuffix(run) {
    if (NOT_BEFORE_SUFFIX.includes(run) || isNotName(run)) return run;
    const title = TITLES.find((t) => run.endsWith(t));
    if (title) {
      // 예: 물류팀장님 → 직함만 있으면 그대로, 박지우팀장님 → 이름 부분만 가림
      const head = run.slice(0, run.length - title.length);
      if (isNameLike(head) && !isNotName(head)) return MARK + title;
      return run;
    }
    return MARK;
  }

  function mask(text) {
    let s = String(text);
    s = s.replace(PHONE, "[전화번호]");
    s = s.replace(EMP_ID, "$1[사번]");
    s = s.replace(NAME_TITLE, (m) => (isNotName(m) ? m : MARK));
    s = s.replace(NAME_SUFFIX, (m) => maskSuffix(m));
    s = s.replace(NAME_BARE, (m) => (isNotName(m) ? m : MARK));
    return s.split(MARK).join("[이름]");
  }

  window.Mask = { mask };
})();
