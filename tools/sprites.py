"""16x16 pixel-art sprite sheets for STILL LIFE items and blocks."""

PAL = {
    '.': None,
    'k': (0x14, 0x12, 0x10), 'K': (0x2A, 0x26, 0x20),
    'w': (0xEC, 0xEA, 0xE0), 'W': (0xFF, 0xFF, 0xFB),
    'g': (0x9E, 0x9A, 0x88), 'G': (0x6B, 0x67, 0x59),
    'y': (0xC8, 0xB4, 0x5A), 'Y': (0xE8, 0xD8, 0x84),
    'o': (0x8C, 0x7A, 0x36), 'n': (0x6A, 0x5C, 0x28),
    'b': (0x3C, 0x44, 0xAA), 'r': (0xA8, 0x32, 0x28),
    'e': (0x2E, 0x8B, 0x4A), 'E': (0x5F, 0xD0, 0x7E),
    'm': (0xB8, 0x92, 0x3C), 'M': (0xE4, 0xC0, 0x62),
    's': (0x5A, 0x4A, 0x34), 'S': (0x7E, 0x6A, 0x4C),
    'c': (0xD8, 0xD2, 0xB8), 'C': (0xB4, 0xAE, 0x94),
    'p': (0xE4, 0xD8, 0xB0), 'a': (0x8A, 0x94, 0x66),
    'l': (0xF6, 0xF0, 0xC4), 'v': (0x4A, 0x2C, 0x5E),
    'V': (0x7A, 0x4E, 0x96), 'd': (0x3A, 0x36, 0x30),
    'i': (0xA8, 0xA8, 0xB0), 'I': (0xD8, 0xD8, 0xE0),
    'f': (0x6E, 0x30, 0x28), 'q': (0x22, 0x5A, 0x38),
}

ITEMS = {
"cotton": [
"................","......ee........",".....eEe........","....wwWww.......",
"...wWWWWww......","..wWWwWWWWw.....","..wWWWWWWww.....",".wWWWWwWWWWw....",
".wWWWWWWWWw.....","..wWWWWWWww.....","..wwWWWWww......","....wwwww.......",
".....s.s........","......s.........","......s.........","................"],

"stillcloth": [
"................","................","..yyyyyyyyyy....",".yYYyyoyyYYyy...",
".yYyyyyyyyoyy...",".yyoyyyyyyyyy...","..yyyyoyyyyy....","...yyyyyyyy.....",
"..yyoyyyyyyy....",".yyyyyyyoyyy....",".yYyyoyyyyyYy...",".yyyyyyyyyyy....",
"..yyyyoyyyy.....","...yyyyyyy......","................","................"],

"almond_water": [
"................","......ii........","......ii........",".....iIIi.......",
".....iwwi.......","....iwwwwi......","...iwwwwwwi.....","...iwWWWWwi.....",
"...iwWWWWwi.....","...iwWWWWwi.....","...iwWWWWwi.....","...iwwwwwwi.....",
"...iwwwwwwi.....","....iiiiii......","................","................"],

"bitter_almond_water": [
"................","......ii........","......ii........",".....iIIi.......",
".....ioni.......","....ionoi.......","...ionnnoi......","...ionnnnoi.....",
"...ionnnnoi.....","...ionkknoi.....","...ionnnnoi.....","...ionnnnoi.....",
"...ionnnnoi.....","....iiiiii......","................","................"],

"cotton_bandage": [
"................","................","....wwwwww......","...wWWWWWWw.....",
"..wWWccccWWw....","..wWccffccWw....","..wWcffffcWw....","..wWccffccWw....",
"..wWWccccWWw....","...wWWWWWWw.....","....wwwwww......","................",
"................","................","................","................"],

"flicker_lantern": [
"................","......kk........",".....k..k.......","....kkkkkk......",
"...kMMMMMMk.....","...kMlllllMk....","...kMlYYlMk.....","...kMlYYYlMk....",
"...kMlYYlMk.....","...kMlllllMk....","...kMMMMMMk.....","....kkkkkk......",
".....kkkk.......","................","................","................"],

"camcorder": [
"................","................","......kkk.......",".....kdddk......",
"..kkkkkkkkkkk...","..kdddddddddk...","..kddiiiddddk...","..kdiIIIiddIk...",
"..kdiIkIiddIk...","..kddiiiddddk...","..kdddddddddk...","..kkkkkkkkkkk...",
"...kk.....kk....","................","................","................"],

"polaroid": [
"................","..wwwwwwwwwww...","..wkkkkkkkkkw...","..wkyyyyyyykw...",
"..wkyyyoyyykw...","..wkyoyyyyokw...","..wkyyykyyykw...","..wkyykkkyykw...",
"..wkyyykyyykw...","..wkyyyyyyykw...","..wkkkkkkkkkw...","..wwwwwwwwwww...",
"..wwwwwwwwwww...","..wwwwwwwwwww...","................","................"],

"noclip_charm": [
"................","......VVV.......",".....VvvvV......","....Vvv.vvV.....",
"...Vvv...vvV....","...Vv..k..vV....","..Vvv.kEk.vvV...","..Vv..kEk..vV...",
"..Vvv.kEk.vvV...","...Vv..k..vV....","...Vvv...vvV....","....Vvv.vvV.....",
".....VvvvV......","......VVV.......","................","................"],

"exit_sign_shard": [
"................","................","........ee......",".......eEEe.....",
"......eEwwEe....",".....eEwwwwEe...","....eEwwEEwwEe..","...eEwwEwwEwwE..",
"...eEwwEwwEwwe..","....eEwwEEwwe...",".....eEwwwwe....","......eEwwe.....",
".......eEEe.....","........ee......","................","................"],

"frontrooms_key": [
"................","................","....mmmm........","...mMkkMm.......",
"...mMk.kMm......","...mMk.kMm......","...mMkkMm.......","....mmmm........",
".....mm.........",".....mm.........",".....mm.........",".....mmm........",
".....mm.mm......",".....mm.........",".....mmmm.......","................"],

"stillcloth_hood": [
"................","................","....yyyyyy......","...yYYYYYYy.....",
"..yYyyyyyyYy....",".yYyyoyyoyyYy...",".yYyyyyyyyyYy...",".yyyy....yyyy...",
".yyy......yyy...","..yy......yy....","..yy......yy....","...yy....yy.....",
"................","................","................","................"],

"stillcloth_tunic": [
"................","................",".yyy......yyy...",".yYyyyyyyyyYy...",
"yYyyyyoyyyyyYy..","yYyyyyyyyyyyYy..","yyyyyoyyyoyyyy..",".yyyyyyyyyyyy...",
".yyyyyyyyyyyy...",".yyyoyyyyoyyy...",".yyyyyyyyyyyy...",".yyyyyyyyyyyy...",
".yyyyy..yyyyy...",".yyyy....yyyy...","................","................"],

"stillcloth_trousers": [
"................","................","................",".yyyyyyyyyyy....",
".yYyyyyoyyYy....",".yyyyyyyyyyy....",".yyyyy.yyyyy....",".yyyy...yyyy....",
".yyyy...yyyy....",".yyoy...yyyy....",".yyyy...yyoy....",".yyyy...yyyy....",
".yyyy...yyyy....",".yyy.....yyy....","................","................"],

"stillcloth_treads": [
"................","................","................","................",
"................",".yyy......yyy...",".yYy......yYy...",".yyy......yyy...",
".yyyy....yyyy...",".yyyyy..yyyyy...","kkkkkk..kkkkkk..","kKKKKk..kKKKKk..",
"kkkkkk..kkkkkk..","................","................","................"],

"hum_tuner": [
"................","....ii....ii....","....iI....Ii....","....iI....Ii....",
"....iI....Ii....","....iI....Ii....","....iIiiiiIi....",".....iIiiIi.....",
"......iIIi......","......iIIi......","......iIIi......","......immi......",
"......iMMi......","......iMMi......","......immi......","................"],

"tall_ones_tooth": [
"................","................","......ww........",".....wWWw.......",
"....wWWWWw......","....wWWWWw......","....wWWWWw......","....cWWWWc......",
".....cWWc.......",".....cWWc.......","......cc........","......cc........",
"......c.........","................","................","................"],

"clarks_whistle": [
"................","................","................","....mmmmmm......",
"...mMMMMMMm.....","..mMMkkkkMMm....","..mMMkKKkMMmm...","..mMMkkkkMMmmm..",
"..mMMMMMMMMm....","...mMMMMMMm.....","....mmmmmm......",".....mm.........",
".....mm.........","................","................","................"],

"static_blade": [
"................","............iI..","...........iIw..","..........iIwi..",
".........iIwi...","........iIwi....",".......iIwi.....","......iIwi......",
".....iIwi.......","....iIwi........","...iIwi.........","..sSsi..........",
".sSsSs..........","..sSs...........","..s.............","................"],

"wall_pry_bar": [
"................","............ii..","...........iII..","..........iIi...",
".........iIi....","........iIi.....",".......iIi......","......iIi.......",
".....iIi........","....iIi.........","...iIi..........","..iIi...........",
".iIIi...........","iIi.............","ii..............","................"],

"sanity_anchor": [
"................","......ll........",".....lYYl.......","....lYWWYl......",
"...lYWllWYl.....","...lYWlllWYl....","...lYWllWYl.....","....lYWWYl......",
".....lYYl.......","......ll........","....ssssss......","...sSSSSSSs.....",
"...ssssssss.....","................","................","................"],

"distorted_compass": [
"................","................",".....mmmmm......","....mMMMMMm.....",
"...mMkkkkkMm....","..mMkddddkMm....","..mMkdrdddkMm...","..mMkddrddkMm...",
"..mMkdddwdkMm...","..mMkddddkMm....","...mMkkkkkMm....","....mMMMMMm.....",
".....mmmmm......","................","................","................"],

"reel_of_tape": [
"................","................","....kkkkkk......","...kdddddddk....",
"..kddKKKKKddk...","..kdKdddddKdk...",".kddKddkddKddk..",".kdKddkkkddKdk..",
".kddKddkddKddk..","..kdKdddddKdk...","..kddKKKKKddk...","...kdddddddk....",
"....kkkkkk......","................","................","................"],

"still_essence": [
"................","................",".......y........","......yYy.......",
".....yYlYy......","....yYlWlYy.....","...yYlWWWlYy....","...yYlWWWlYy....",
"...yYlWWWlYy....","....yYlWlYy.....",".....yYlYy......","......yYy.......",
".......y........","................","................","................"],
}

# ----------------------------------------------------------------- blocks
BLOCKS = {
"wallpaper": [
"yyyyyyyyyyyyyyyy","yYyyoyyyyyyyoyYy","yyyyyyyyoyyyyyyy","yoyyyyyyyyyyoyyy",
"yyyyyyoyyyyyyyyy","yyoyyyyyyyoyyyyy","yyyyyyyyyyyyyyoy","yYyyyyyoyyyyyyYy",
"yyyyoyyyyyyyyyyy","yyyyyyyyyyoyyyyy","yoyyyyyoyyyyyyyy","yyyyyyyyyyyyoyyy",
"yyyoyyyyyoyyyyyy","yYyyyyyyyyyyyyYy","yyyyyyoyyyyoyyyy","yyyyyyyyyyyyyyyy"],

"wallpaper_torn": [
"yyyyyyyyyyyyyyyy","yYyyoyynnnyyoyYy","yyyyyyynGGnyyyyy","yoyyyyynGGGnyyyy",
"yyyyyyonGGGGnyyy","yyoyyyynGGGGnyyy","yyyyyyyynGGGnyoy","yYyyyyyonGGnyyYy",
"yyyyoyyynGGGnyyy","yyyyyyyynGGnyyyy","yoyyyyyonGnyyyyy","yyyyyyyynnyyoyyy",
"yyyoyyyyyoyyyyyy","yYyyyyyyyyyyyyYy","yyyyyyoyyyyoyyyy","yyyyyyyyyyyyyyyy"],

"damp_carpet": [
"nnononnonnononno","onnonoonononnoon","nonnononnonnonon","onononnononoonno",
"nnononoonnononon","ononnononoononno","nnoononnononnoon","onononoonnononon",
"nnononnononoonno","ononoonnononnoon","nonnononoononnon","onononnonnoonono",
"nnononoononononn","ononnononoononno","nnoononnonononon","onononoonnononno"],

"ceiling_tile": [
"CCCCCCCCCCCCCCCC","CccccccccccccccC","CcCcCcCcCcCcCccC","CccccccccccccccC",
"CcCcCcCcCcCcCccC","CccccccccccccccC","CcCcCcCcCcCcCccC","CccccccccccccccC",
"CcCcCcCcCcCcCccC","CccccccccccccccC","CcCcCcCcCcCcCccC","CccccccccccccccC",
"CcCcCcCcCcCcCccC","CccccccccccccccC","CcCcCcCcCcCcCccC","CCCCCCCCCCCCCCCC"],

"buzzing_light": [
"CCCCCCCCCCCCCCCC","CkkkkkkkkkkkkkkC","CkllllllllllllkC","CklWWWWWWWWWWlkC",
"CklWlllllllllWkC","CklWlWWWWWWWlWkC","CklWlWlllllWlWkC","CklWlWlWWWlWlWkC",
"CklWlWlWWWlWlWkC","CklWlWlllllWlWkC","CklWlWWWWWWWlWkC","CklWlllllllllWkC",
"CklWWWWWWWWWWlkC","CkllllllllllllkC","CkkkkkkkkkkkkkkC","CCCCCCCCCCCCCCCC"],

"moist_wall": [
"yyyoyyyynnyyyyoy","yyoyyyynGGnyyyyy","yoyyyynGGGGnyyyy","yyyyynGGqqGGnyyy",
"yyyynGGqqqqGGnyy","yyynGGqqqqqqGnyy","yyynGqqqqqqqGnyy","yyoyGqqqqqqqGyyy",
"yyyynGqqqqqGnyyy","yyyynGGqqqGGnyyy","yyyyynGGqGGnyyoy","yyyyyynGGGnyyyyy",
"yyoyyyynGGnyyyyy","yyyyyyyynnyyyyyy","yyyyoyyyyyyoyyyy","yyyyyyyyyyyyyyyy"],

"exit_door": [
"kkkkkkkkkkkkkkkk","kqqqqqqqqqqqqqqk","kqEEEEEEEEEEEEqk","kqEwEwwwEwwEwEqk",
"kqEwEw...w.wEwqk","kqEwwwwEw.wwEwqk","kqEwEw..Ew.wEwqk","kqEwEwwwEw.wEwqk",
"kqEEEEEEEEEEEEqk","kqqqqqqqqqqqqqqk","kkkkkkkkkkkkkkkk","kddddddddddddddk",
"kdddddddddddmMdk","kddddddddddddddk","kddddddddddddddk","kkkkkkkkkkkkkkkk"],

"noclip_rift": [
"kkkkKkkkkkKkkkkk","kkKvvvKkkvvvKkkk","kKvVVVvKkvVVvKkk","KvVVkkVvKvVkVvKk",
"kvVkkkkVvvVkkVvk","kvVkk..kVVk..Vvk","kVkk....kkk...kV","kVk..........kkV",
"kVkk.........kkV","kvVkk..kVVk..Vvk","kvVkkkkVvvVkkVvk","KvVVkkVvKvVkVvKk",
"kKvVVVvKkvVVvKkk","kkKvvvKkkvvvKkkk","kkkkKkkkkkKkkkkk","kkkkkkkkkkkkkkkk"],

"sanity_anchor_block": [
"sSsSsSsSsSsSsSss","SssssssssssssssS","ssllllllllllllss","slYYYYYYYYYYYYls",
"slYWWWWWWWWWWYls","slYWlllllllllWls","slYWlWWWWWWWlWls","slYWlWlllllWlWls",
"slYWlWlllllWlWls","slYWlWWWWWWWlWls","slYWlllllllllWls","slYWWWWWWWWWWYls",
"slYYYYYYYYYYYYls","ssllllllllllllss","SssssssssssssssS","sSsSsSsSsSsSsSss"],

"cotton_bale": [
"CwwwwCwwwwCwwwwC","wWWWWwWWWWwWWWWw","wWwWWwWWwWwWWWWw","wWWWWwWWWWwWwWWw",
"CwwwwCwwwwCwwwwC","wWWWWwWwWWwWWWWw","wWWwWwWWWWwWWwWw","wWWWWwWWWWwWWWWw",
"CwwwwCwwwwCwwwwC","wWWWWwWWWWwWWWWw","wWwWWwWWwWwWWWWw","wWWWWwWWWWwWwWWw",
"CwwwwCwwwwCwwwwC","wWWWWwWwWWwWWWWw","wWWwWwWWWWwWWwWw","CwwwwCwwwwCwwwwC"],

"exit_sign": [
"kkkkkkkkkkkkkkkk","kkkkkkkkkkkkkkkk","kqqqqqqqqqqqqqqk","kqEEEEEEEEEEEEqk",
"kqEwwwEwEwwwEwqk","kqEw...EwE.w..qk","kqEwwwEwwwEw..qk","kqEw....w.Ew..qk",
"kqEwwwEwEwwwEwqk","kqEEEEEEEEEEEEqk","kqqqqqqqqqqqqqqk","kkkkkkkkkkkkkkkk",
"kkkkkkkkkkkkkkkk","................","................","................"],

"hum_speaker": [
"dddddddddddddddd","dKKKKKKKKKKKKKKd","dK..kkkkkkkk..Kd","dK.kddddddddk.Kd",
"dK.kdKKKKKKdk.Kd","dK.kdKddddKdk.Kd","dK.kdKdKKdKdk.Kd","dK.kdKdKKdKdk.Kd",
"dK.kdKddddKdk.Kd","dK.kdKKKKKKdk.Kd","dK.kddddddddk.Kd","dK..kkkkkkkk..Kd",
"dK....mMMm....Kd","dKKKKKKKKKKKKKKd","dddddddddddddddd","dddddddddddddddd"],
}
