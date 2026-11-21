"""이메일 보내기 (아이디 찾기·비밀번호 재설정 번호).

Render 무료 서버는 메일 포트(SMTP)가 막혀 있어서, 웹 주소로 메일을 보내는 Brevo 서비스를 쓴다.
환경 변수 (Render 설정 화면에만 넣는다. 코드·채팅에는 절대 넣지 않는다):
  BREVO_API_KEY   Brevo > SMTP & API > API Keys 에서 만든 키
  MAIL_FROM       Brevo 에 "보내는 사람"으로 등록·인증한 이메일 주소
"""
import os

import requests

NAME = "AI W.E.P"

TEXT = {
    "ko": {
        "code_subject": "[AI W.E.P] 비밀번호 재설정 번호",
        "code_body": "아이디 {login_id} 의 비밀번호 재설정 번호는 {code} 입니다.\n15분 안에 앱에 입력하세요.\n직접 요청하지 않았다면 이 메일을 무시하세요.",
        "ids_subject": "[AI W.E.P] 아이디 안내",
        "ids_body": "이 이메일로 가입한 아이디입니다:\n{ids}\n",
    },
    "en": {
        "code_subject": "[AI W.E.P] Password reset code",
        "code_body": "The password reset code for ID {login_id} is {code}.\nEnter it in the app within 15 minutes.\nIf you did not ask for this, ignore this email.",
        "ids_subject": "[AI W.E.P] Your ID",
        "ids_body": "IDs registered with this email:\n{ids}\n",
    },
    "vi": {
        "code_subject": "[AI W.E.P] Mã đặt lại mật khẩu",
        "code_body": "Mã đặt lại mật khẩu cho ID {login_id} là {code}.\nHãy nhập vào ứng dụng trong vòng 15 phút.\nNếu bạn không yêu cầu, hãy bỏ qua email này.",
        "ids_subject": "[AI W.E.P] ID của bạn",
        "ids_body": "Các ID đã đăng ký bằng email này:\n{ids}\n",
    },
    "th": {
        "code_subject": "[AI W.E.P] รหัสรีเซ็ตรหัสผ่าน",
        "code_body": "รหัสรีเซ็ตรหัสผ่านของ ID {login_id} คือ {code}\nกรุณากรอกในแอปภายใน 15 นาที\nหากคุณไม่ได้ขอ กรุณาเพิกเฉยอีเมลนี้",
        "ids_subject": "[AI W.E.P] ID ของคุณ",
        "ids_body": "ID ที่ลงทะเบียนด้วยอีเมลนี้:\n{ids}\n",
    },
    "fil": {
        "code_subject": "[AI W.E.P] Code para i-reset ang password",
        "code_body": "Ang code para i-reset ang password ng ID {login_id} ay {code}.\nIlagay ito sa app sa loob ng 15 minuto.\nKung hindi ikaw ang humiling, huwag pansinin ang email na ito.",
        "ids_subject": "[AI W.E.P] Ang iyong ID",
        "ids_body": "Mga ID na nakarehistro sa email na ito:\n{ids}\n",
    },
    "uz": {
        "code_subject": "[AI W.E.P] Parolni tiklash kodi",
        "code_body": "{login_id} ID uchun parolni tiklash kodi: {code}.\nUni 15 daqiqa ichida ilovaga kiriting.\nAgar siz so'ramagan bo'lsangiz, bu xatni e'tiborsiz qoldiring.",
        "ids_subject": "[AI W.E.P] Sizning ID",
        "ids_body": "Ushbu email bilan ro'yxatdan o'tgan ID lar:\n{ids}\n",
    },
    "id": {
        "code_subject": "[AI W.E.P] Kode atur ulang kata sandi",
        "code_body": "Kode atur ulang kata sandi untuk ID {login_id} adalah {code}.\nMasukkan di aplikasi dalam 15 menit.\nJika Anda tidak memintanya, abaikan email ini.",
        "ids_subject": "[AI W.E.P] ID Anda",
        "ids_body": "ID yang terdaftar dengan email ini:\n{ids}\n",
    },
    "es": {
        "code_subject": "[AI W.E.P] Código para restablecer la contraseña",
        "code_body": "El código para restablecer la contraseña del ID {login_id} es {code}.\nIntrodúcelo en la app en 15 minutos.\nSi no lo solicitaste, ignora este correo.",
        "ids_subject": "[AI W.E.P] Tu ID",
        "ids_body": "IDs registrados con este correo:\n{ids}\n",
    },
}


class MailError(Exception):
    pass


def configured():
    return bool(os.environ.get("BREVO_API_KEY") and os.environ.get("MAIL_FROM"))


def _text(lang):
    return TEXT.get(lang) or TEXT["en"]


def send(to, subject, body):
    if not configured():
        raise MailError("mail_not_configured")
    r = requests.post("https://api.brevo.com/v3/smtp/email", timeout=30, headers={
        "api-key": os.environ["BREVO_API_KEY"], "accept": "application/json", "content-type": "application/json",
    }, json={
        "sender": {"email": os.environ["MAIL_FROM"], "name": NAME},
        "to": [{"email": to}],
        "subject": subject,
        "textContent": body,
    })
    if r.status_code >= 300:
        raise MailError(f"brevo {r.status_code}: {r.text[:200]}")


def send_code(to, login_id, code, lang):
    t = _text(lang)
    send(to, t["code_subject"], t["code_body"].format(login_id=login_id, code=code))


def send_ids(to, ids, lang):
    t = _text(lang)
    send(to, t["ids_subject"], t["ids_body"].format(ids="\n".join(f"- {i}" for i in ids)))
