"""Connect the fracture profile workspace to photo preparation."""

from io import BytesIO
import os
from pathlib import Path

from flask import Blueprint, jsonify, render_template, request, send_file, url_for

from image_lab import create_app as preparation_app
from image_lab.validation import Invalid, identifier, integer, number, object_value

from . import exports, contour, pairing
from .store import Cards


def download(data, mime, filename):
    return send_file(BytesIO(data), mimetype=mime, max_age=0, download_name=filename, as_attachment=True)


def create_app(directory=None):
    root = Path(directory or os.environ.get("CHIPCONTOUR_DATA", ".chipcontour-data")).resolve()
    desk = preparation_app(root / "prepare")
    cards = Cards(root / "cards")
    api = Blueprint("chipcontour", __name__, url_prefix="/chipcontour")

    @desk.get("/")
    def home():
        return render_template("chipcontour.html")

    @api.get("/health")
    def health():
        return jsonify(status="ok", app="chipcontour")

    @api.get("/cards")
    def listing():
        return jsonify(cards=cards.list())

    @api.post("/cards")
    def create():
        request.max_content_length = 20 * 1024 * 1024
        upload = request.files.get("photo")
        if not upload or not upload.filename:
            raise Invalid("请选择断片原照")
        size, image = contour.decode(upload.stream.read(contour.MAX_IMAGE_BYTES + 1))
        return jsonify(cards.create(request.form.get("name", ""), Path(upload.filename).name[:140],
                                    size, image, contour.defaults(size))), 201

    @api.post("/practice")
    def practice():
        return jsonify(cards.demo()), 201

    @api.route("/cards/<key>", methods=["GET", "PATCH"])
    def card(key):
        return jsonify(cards.update(key, object_value(request.get_json(silent=True), "断片卡设置"))
                       if request.method == "PATCH" else cards.read(key))

    @api.post("/pairing")
    def pair_cards():
        body = object_value(request.get_json(silent=True), "对合请求")
        first = cards.read(identifier(body.get("first")))
        second = cards.read(identifier(body.get("second")))
        if first["id"] == second["id"]:
            raise Invalid("请选择两张不同的断片卡")
        max_shift = integer(body.get("max_shift"), "上下位移上限", 0, 2000)
        tolerance = number(body.get("tolerance"), "改变量允许差", 0, 100)
        first_outline = contour.source_outline(contour.pixels(cards.photo(first["id"])), first["settings"])
        second_outline = contour.source_outline(contour.pixels(cards.photo(second["id"])), second["settings"])
        return jsonify(candidates=pairing.align(first_outline, second_outline, max_shift, tolerance))

    @api.get("/cards/<key>/capture.png")
    def capture(key):
        return send_file(cards.photo(key), mimetype="image/png", conditional=True)

    def measurement(key):
        card = cards.read(key, request.args.get("revision"))
        image = contour.pixels(cards.photo(key))
        return card, image, contour.report(image, card["settings"])

    @api.get("/cards/<key>/measurement")
    def measurement_json(key):
        card, _, result = measurement(key)
        return jsonify(revision=card["revision"], **result)

    @api.get("/cards/<key>/probe")
    def probe(key):
        card = cards.read(key, request.args.get("revision"))
        x = integer(request.args.get("x"), "X", 0, card["width"] - 1)
        y = integer(request.args.get("y"), "Y", 0, card["height"] - 1)
        return jsonify(contour.point(contour.pixels(cards.photo(key)), x, y, card["settings"]))

    @api.get("/cards/<key>/export/profile.csv")
    def profile(key):
        _, _, result = measurement(key)
        return download(exports.trace_table(result), "text/csv", "chip-profile.csv")

    @api.get("/cards/<key>/export/proof.png")
    def proof(key):
        card, image, result = measurement(key)
        return download(exports.proof(image, card, result), "image/png", "chip-proof.png")

    @api.get("/cards/<key>/export/observation.zip")
    def bundle(key):
        card, image, result = measurement(key)
        package = exports.package(card, cards.photo(key).read_bytes(), image, result)
        return download(package, "application/zip", f"chipcontour-r{card['revision']}.zip")

    @api.post("/cards/<key>/prepare")
    def prepare(key):
        card = cards.read(key, request.args.get("revision"))
        image = contour.pixels(cards.photo(key)).astype("float32") / 255
        services = desk.extensions
        asset = services["assets"].put(image, card["photo_name"])
        project = services["store"].create(f'{card["name"]} · 原片准备')
        services["frames"].add(project["id"], project["revision"], [asset["id"]])
        return jsonify(url=url_for("index", project=project["id"])), 201

    desk.register_blueprint(api)
    return desk
