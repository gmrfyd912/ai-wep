"""인쇄용 아루코 마커 PDF 만들기 (A4, 벡터라서 인쇄 크기가 정확함).
실행: python tools/make_marker_pdf.py --dict AIWEP_LEGACY --id 0 --size 30 --out marker.pdf"""
import argparse
import os
import sys

import cv2
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas


def draw_marker(c, bits, x, y, size):
    n = bits.shape[0]
    cell = size / n
    c.setFillColorRGB(0, 0, 0)
    c.rect(x, y, size, size, stroke=0, fill=1)
    c.setFillColorRGB(1, 1, 1)
    for r in range(n):
        for col in range(n):
            if bits[r, col]:
                c.rect(x + col * cell, y + (n - 1 - r) * cell, cell, cell, stroke=0, fill=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dict", default="AIWEP_LEGACY")
    ap.add_argument("--id", type=int, default=0)
    ap.add_argument("--size", type=float, default=30.0, help="검은 사각형 한 변(mm)")
    ap.add_argument("--out", default="marker.pdf")
    a = ap.parse_args()
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from engine.marker import _dictionary
    d = _dictionary(a.dict)
    nb = d.markerSize + 2
    img = cv2.aruco.generateImageMarker(d, a.id, nb, borderBits=1)
    bits = img > 127

    # PDF 안 글자는 영어·숫자만 (한글 글꼴이 없는 PC에서도 깨지지 않도록). 사용 방법은 채팅으로 안내.
    c = canvas.Canvas(a.out, pagesize=A4)
    W, H = A4
    c.setFont("Helvetica-Bold", 13)
    c.drawString(20 * mm, H - 20 * mm, f"AI W.E.P  ArUco {a.dict}  ID {a.id}  -  {a.size:g} mm")
    c.setFont("Helvetica", 10)
    c.drawString(20 * mm, H - 28 * mm, "Print at 100% (Actual size). Check: the line below must be 100 mm.")
    # 100mm 눈금선
    y = H - 45 * mm
    c.setLineWidth(0.6)
    c.line(20 * mm, y, 120 * mm, y)
    for k in range(11):
        h = 4 * mm if k % 5 == 0 else 2.5 * mm
        c.line((20 + 10 * k) * mm, y, (20 + 10 * k) * mm, y + h)
    c.drawString(122 * mm, y - 1 * mm, "100mm")
    # 마커 4개 (예비용), 각 마커 둘레 흰 여백 + 잘라내기용 얇은 회색선
    s = a.size * mm
    margin = 8 * mm
    positions = [(30, 70), (110, 70), (30, 150), (110, 150)]
    for px, py in positions:
        x, yb = px * mm, H - py * mm - s
        c.setStrokeColorRGB(0.75, 0.75, 0.75)
        c.setLineWidth(0.3)
        c.rect(x - margin, yb - margin, s + 2 * margin, s + 2 * margin, stroke=1, fill=0)
        draw_marker(c, bits, x, yb, s)
    c.showPage()
    c.save()
    print("저장:", a.out)


if __name__ == "__main__":
    main()
