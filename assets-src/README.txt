Source 3D models used only to bake the tree impostor atlases in public/impostors (run /bake.html on the dev server).
They are not loaded by the game. All from Poly Haven (https://polyhaven.com), licensed CC0 1.0:
fir_sapling, island_tree_02, shrub_04 (glTF, 1k textures).
broadleaf_a, broadleaf_b, conifer_a are not downloads: tools/blender/tree_gen.py builds them from scratch, every leaf
as geometry (about 300k triangles each; the fir 676k, a 50 MB file). They are the forest's two broadleaf trees and its
fir (atlas sets bo, b2o, co: /bake.html?only=bo,b2o,co). fir_tree_01, island_tree_01 and island_tree_03 now only feed
the older ring-of-views atlases (c, b, b2) that game.trees.setOcta(false) switches back to.
  Blender -b --factory-startup --python tools/blender/tree_gen.py -- "$PWD" broadleaf_a [--preview <dir>]

props/: models for the street-life prop kit (stalls, carts, ships…). Drop Sketchfab glTF downloads here as the zips they
come in; tools/blender/props_kit.py matches them to slots by file name, bakes them into public/models/props.* and writes
the attribution they require (most are CC-BY) to public/models/props_credits.txt. Slots with no download get a stand-in.
Townsfolk (person_a…d) come from rigged character downloads (Mixamo skeleton, e.g. Adobe Fuse models): the kit cuts each
to ~500 triangles and bakes idle, walk and talk loops (CLIPS in props_kit.py) as shape keys, which the game plays per
instance in the prop shader (animateProps in src/world/castlekit.js; walkers' beats are set in src/world/cityprops.js). Now: fuse_civilian_1, medieval_civilian_3,
fuse_woman_1, medieval_poor_woman. To add or swap one, drop its zip here and name it in that slot's `use` list in SLOTS.
  Blender -b --factory-startup --python tools/blender/props_kit.py -- "$PWD"            (add --list to see what is in each zip)

riders/knight/: the standing knight scan (Tripo, unrigged) that rides Drogon in the Unreal prototype. unreal/Dragonrider/Tools/blender/rider_knight.py
seats him and writes unreal/Dragonrider/Tools/gen/rider_knight.*; see the rider section of unreal/Dragonrider/README.md.

cliffs/Blackwater Ledges.blend contains the coastal formations fitted to the Red Keep headland.
The playable meshes, distance meshes, photographic colour/normal/roughness maps and metre-spaced
landing surfaces are packed into public/models/blackwater_ledges.glb. tools/blender/blackwater_coast.py
builds the coast from the source glTF scans. Within the supplied scan directory, each asset ID below
is a folder containing its .gltf, .bin and textures/ directory.

Source scans from Poly Haven, CC0 (https://polyhaven.com/license).
Rob Tuytel photographed and processed the coastal scans. Rico Cilliers cleaned Coastal Cliff 01/04,
Coast Rocks 03 and Coast Land Rocks 03, and authored Boulder 01.
https://polyhaven.com/a/coastal_cliff_01
https://polyhaven.com/a/coastal_cliff_02
https://polyhaven.com/a/coastal_cliff_04
https://polyhaven.com/a/coast_rocks_03
https://polyhaven.com/a/coast_rocks_05
https://polyhaven.com/a/coast_land_rocks_03
https://polyhaven.com/a/boulder_01

cliffs/Blackwater Headland.blend contains the full seaward cliff below the Red Keep.
The twelve cliff sectors, twenty-four buttresses, tidal grotto and three inlet formations
each have three levels of detail. The inlet fronts reconstruct stone from the supplied
cliff-and-water image using estimated monocular depth and traced rock boundaries.
Their hidden faces use reconstructed limestone, and all three formations are closed
meshes. Vertex colours record shelter and soil on ledges. The playable geometry,
PBR maps and metre-spaced collision samples ship in public/models/blackwater_headland.glb.

Run tools/blender/headland_scans.py with the Poly Haven scan directory, working
directory and supplied cliff-and-water PNG. A fourth argument accepts an existing
1456 x 816 float32 relative-depth .npy. Otherwise the preparation step needs torch
and transformers to run Depth Anything V2 Small. Then run blackwater_headland.py
in Blender with the working directory and scan directory. The preview named inlet
in src/tools/lookdev.js matches the reference camera.

Source scans are Coastal Cliff 01, 02, 04 and Rock Face 01 from Poly Haven (CC0).
Smaller geometric fractures also use the shipped Rock Face 03 displacement map.
The reference photograph and derived textures are separate from those CC0 scans.
https://polyhaven.com/a/rock_face_01
https://polyhaven.com/a/rock_face_03
