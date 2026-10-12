// « BLEU INTERDIT » : GLSL du flacon (SPEC_PERFUME §2.4, WP3).
//
// Aucun `transmission`, aucune passe de rendu en plus. Le cristal est un faux réfracteur :
//   - PB_Juice (renderOrder 0.5, NoBlending, depthWrite) : volume de jus cobalt, absorption de Beer-Lambert
//     sur l'épaisseur bakée (uv1.x), réfraction jusqu'à la paroi arrière de la cavité (parallaxe de la rosace),
//     surface libre (faces arrière) avec ménisque et ride de frappe ;
//   - PB_Glass (renderOrder 11.5, prémultiplié, depthWrite off) : coque fresnel + épaisseur + contour TIR,
//     bande satinée qui se givre en séchant, ruissellement mouillé, réfraction positionnellement juste
//     de l'affiche (plan marqueur z = 0) ou de la sonde de la cour (projection en boîte) ;
//   - PB_Gold / PB_Cap : MeshPhysicalMaterial patché (heurtoir et poussoir en vertex, sonde de la cour,
//     flash de frappe, chasse de reflets, AO bakée, révélation) ;
//   - StudGlints : 3 étoiles additives en InstancedMesh.
// Les niveaux de qualité sont des uniforms (uTier), jamais des defines : changer de niveau ne recompile rien.
// Toutes les sorties passent par <tonemapping_fragment> + <colorspace_fragment> (Neutral, comme le rouge à lèvres).

// ---------------------------------------------------------------------------------------------------------
// Uniforms communs (déclarations GLSL ; les valeurs vivent dans un seul objet U partagé, cf. perfume.js)
// ---------------------------------------------------------------------------------------------------------
export const PB_COMMON_UNIFORMS = /* glsl */`
uniform mat4 uWorldToGarden;
uniform mat4 uWorldToMarker;
uniform vec3 uCamLocal;
uniform float uOutside;
uniform samplerCube uProbe;
uniform vec3 uProbePos;
uniform vec3 uRoomMin;
uniform vec3 uRoomMax;
uniform float uProbeGain;
uniform samplerCube uStudio;
uniform float uStudioGain;
uniform sampler2D uPoster;
uniform sampler2D uDoorMask;
uniform vec3 uPosterGain;
uniform float uMarkerAspect;
uniform vec3 uGardenMeta;
uniform vec4 uPool;
uniform float uWaterY;
uniform float uClip;
uniform vec3 uFillP;
uniform vec3 uFillN;
uniform vec3 uKeyDir;
uniform vec3 uKeyCol;
uniform vec3 uRimDir;
uniform vec3 uRimCol;
uniform float uReveal;
uniform vec3 uScanOrigin;
uniform vec3 uScanAxis;
uniform float uScanHeight;
uniform vec3 uBandColor;
uniform float uTier;
uniform float uTime;
uniform float uGlow;
`

// ---------------------------------------------------------------------------------------------------------
// Fonctions partagées : schlick, sonde en boîte, studio, env (réflexion), backdrop (réfraction)
// ---------------------------------------------------------------------------------------------------------
export const PB_GLSL_SCHLICK = /* glsl */`
float pbSq( float x ) { return x * x; }
float pbSchlick( float f0, float NV ) { return f0 + ( 1.0 - f0 ) * pow( 1.0 - clamp( NV, 0.0, 1.0 ), 5.0 ); }
float pbHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
vec3 pbSafeDir( vec3 d ) {
  return vec3( abs( d.x ) < 1e-4 ? 1e-4 : d.x, abs( d.y ) < 1e-4 ? 1e-4 : d.y, abs( d.z ) < 1e-4 ? 1e-4 : d.z );
}
`

// Sonde de la cour (probes.pool) projetée dans la boîte de la cour (repère jardin, mètres).
// Le point peut être hors de la boîte (porte, vitrine) : on prend toujours la sortie (tFar).
export const PB_GLSL_PROBE_BOX = /* glsl */`
vec3 pbProbeBox( vec3 Pg, vec3 Rg, float lod ) {
  vec3 R = pbSafeDir( Rg );
  vec3 t1 = ( uRoomMin - Pg ) / R;
  vec3 t2 = ( uRoomMax - Pg ) / R;
  vec3 tf = max( t1, t2 );
  float t = max( min( min( tf.x, tf.y ), tf.z ), 0.0 );
  vec3 H = Pg + Rg * t;
  return textureLod( uProbe, H - uProbePos, lod ).rgb * uProbeGain;
}
vec3 pbStudio( vec3 Rw, float lod ) { return textureLod( uStudio, Rw, lod ).rgb * uStudioGain; }
vec3 pbToGarden( vec3 Pw ) { return ( uWorldToGarden * vec4( Pw, 1.0 ) ).xyz; }
vec3 pbDirToGarden( vec3 Dw ) { return normalize( mat3( uWorldToGarden ) * Dw ); }
`

// env(R, rough) = mix(sonde en boîte, studio, uOutside)
export const PB_GLSL_ENV = /* glsl */`
vec3 pbEnv( vec3 Pw, vec3 Rw, float rough ) {
  vec3 c = vec3( 0.0 );
  if ( uOutside < 0.999 ) c = pbProbeBox( pbToGarden( Pw ), pbDirToGarden( Rw ), rough * 7.0 );
  if ( uOutside > 0.001 ) c = mix( c, pbStudio( Rw, rough * 6.0 ), uOutside );
  return c;
}
`

// backdrop(Pw, Dw, lod) : ce qu'on voit derrière le verre le long de Dw.
//  cour  : sonde en boîte ;
//  devant: intersection du rayon avec le plan de l'affiche (marqueur z = 0) → affiche × uPosterGain,
//          ou la sonde dans la direction jardin si le masque de porte vaut 1 (ce que three rend dans le trou) ;
//          hors de l'affiche : gris neutre et w → 0 (l'appelant baisse son alpha, la caméra réelle transparaît) ;
//          point déjà derrière l'affiche (traversée du portail) : la cour.
//  même chemin à tous les niveaux de qualité.
export const PB_GLSL_BACKDROP = /* glsl */`
vec3 pbBackdrop( vec3 Pw, vec3 Dw, float lod, out float w ) {
  w = 1.0;
  vec3 c = vec3( 0.0 );
  if ( uOutside < 0.999 ) c = pbProbeBox( pbToGarden( Pw ), pbDirToGarden( Dw ), lod );
  if ( uOutside > 0.001 ) {
    vec3 o;
    float wo = 1.0;
    // tous niveaux : l'affiche (une intersection de plan + 2 lectures). L'ancien repli « studio seul » du niveau bas
    // faisait voir la pièce de l'HDR dans le jus sur téléphone (la qualité auto y tombe souvent en bas).
    {
      vec3 Pm = ( uWorldToMarker * vec4( Pw, 1.0 ) ).xyz;
      vec3 Dm = mat3( uWorldToMarker ) * Dw;
      if ( Pm.z <= 0.0 ) {
        o = pbProbeBox( pbToGarden( Pw ), pbDirToGarden( Dw ), lod );
      } else if ( Dm.z < -1e-5 ) {
        vec3 H = Pm + Dm * ( -Pm.z / Dm.z );
        vec2 uv = vec2( H.x + 0.5, H.y / uMarkerAspect + 0.5 );
        vec2 e = smoothstep( vec2( -0.002 ), vec2( 0.018 ), uv ) * smoothstep( vec2( -0.002 ), vec2( 0.018 ), 1.0 - uv );
        wo = e.x * e.y;
        vec2 uvc = clamp( uv, 0.0, 1.0 );
        vec3 poster = textureLod( uPoster, uvc, lod ).rgb * uPosterGain;
        float m = texture2D( uDoorMask, uvc ).r;
        if ( m > 0.004 ) {
          vec3 Hg = vec3( ( H.x - uGardenMeta.y ) / uGardenMeta.x, ( H.y - uGardenMeta.z ) / uGardenMeta.x, H.z / uGardenMeta.x );
          poster = mix( poster, pbProbeBox( Hg, pbDirToGarden( Dw ), lod ), m );
        }
        o = mix( vec3( 0.5 ), poster, wo );
      } else {
        o = pbStudio( Dw, lod + 1.0 );
      }
    }
    c = mix( c, o, uOutside );
    w = mix( 1.0, wo, uOutside );
  }
  return c;
}
`

// fond RÉEL (lib/majorelle/screenRefraction.js) : copie de l'image déjà dessinée derrière le flacon (caméra 8th Wall,
// affiche, cour, eau, koï, fleurs), prise juste avant le jus. Sur téléphone, l'affiche figée et la sonde faisaient
// paraître le jus vide ; ici le flacon montre ce qui est vraiment derrière lui, déformé et teinté.
// uScreenK = 0 dans la cour et sans copie valide → l'appelant garde pbBackdrop.
export const PB_GLSL_SCREEN = /* glsl */`
uniform sampler2D uScreen;
uniform float uScreenK;
uniform vec2 uScreenPx;          // taille de la copie (= viewport) en pixels
uniform mat4 projectionMatrix;
vec3 pbSrgbToLinear( vec3 c ) {
  return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( vec3( 0.04045 ), c ) );
}
// l'écran au point Pw + Dw · dist (monde) ; blurPx > 0 : flou en croix (satin) ; w : validité (bords de l'écran)
vec3 pbScreen( vec3 Pw, vec3 Dw, float dist, float blurPx, out float w ) {
  vec4 cp = projectionMatrix * ( viewMatrix * vec4( Pw + Dw * dist, 1.0 ) );
  vec2 uv = cp.xy / max( cp.w, 1e-5 ) * 0.5 + 0.5;
  vec2 e = smoothstep( vec2( 0.0 ), vec2( 0.012 ), uv ) * smoothstep( vec2( 0.0 ), vec2( 0.012 ), 1.0 - uv );
  w = e.x * e.y * step( 1e-5, cp.w );
  uv = clamp( uv, vec2( 0.0 ), vec2( 1.0 ) );
  vec3 s = texture2D( uScreen, uv ).rgb;
  if ( blurPx > 0.75 ) {
    vec2 o = blurPx / uScreenPx;
    s = s * 0.2 + 0.2 * ( texture2D( uScreen, uv + vec2( o.x, 0.35 * o.y ) ).rgb + texture2D( uScreen, uv - vec2( o.x, 0.35 * o.y ) ).rgb
                        + texture2D( uScreen, uv + vec2( -0.35 * o.x, o.y ) ).rgb + texture2D( uScreen, uv + vec2( 0.35 * o.x, -o.y ) ).rgb );
  }
  // tampon d'affichage (sRGB, déjà tone-mappé) → linéaire, puis on défait le pied de NeutralToneMapping (r169 : retire
  // x − 6,25x² sous x = 0,08, sinon 0,04, x = canal min) pour que vu-à-travers = vu-directement ; l'épaule n'est pas
  // inversée (elle ferait exploser les blancs du jardin à travers le cobalt)
  vec3 c = pbSrgbToLinear( s );
  #ifdef TONE_MAPPING
  float y = min( c.r, min( c.g, c.b ) );
  float x = y < 0.04 ? sqrt( max( y, 0.0 ) * 0.16 ) : y + 0.04;
  c = ( c + ( x - y ) ) / toneMappingExposure;
  #endif
  return c;
}
`

// sortie : tone mapping de la couleur non prémultipliée puis encodage (même chaîne que <tonemapping/colorspace_fragment>)
export const PB_GLSL_OUT = /* glsl */`
vec3 pbToneMap( vec3 c ) {
  #ifdef TONE_MAPPING
  c = toneMapping( c );
  #endif
  return c;
}
`

export const PB_GLSL = {
  common: PB_COMMON_UNIFORMS,
  schlick: PB_GLSL_SCHLICK,
  probeBox: PB_GLSL_PROBE_BOX,
  env: PB_GLSL_ENV,
  backdrop: PB_GLSL_BACKDROP,
  screen: PB_GLSL_SCREEN,
  out: PB_GLSL_OUT,
}
const SHARED = PB_COMMON_UNIFORMS + PB_GLSL_SCHLICK + PB_GLSL_PROBE_BOX + PB_GLSL_ENV + PB_GLSL_BACKDROP + PB_GLSL_SCREEN + PB_GLSL_OUT

// ---------------------------------------------------------------------------------------------------------
// Vertex commun verre / jus
// ---------------------------------------------------------------------------------------------------------
export const PB_SHELL_VERTEX = /* glsl */`
#ifndef USE_UV1
attribute vec2 uv1;
#endif
uniform vec3 uScanOrigin;
uniform vec3 uScanAxis;
uniform float uScanHeight;
varying vec3 vPw;
varying vec3 vNw;
varying vec3 vPl;
varying vec3 vNl;
varying vec2 vPbUv;
varying vec2 vPbUv1;
varying float vScanH;
void main() {
  vPl = position;
  vNl = normal;
  vPbUv = uv;
  vPbUv1 = uv1;
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vPw = wp.xyz;
  vNw = normalize( ( vec4( normalMatrix * normal, 0.0 ) * viewMatrix ).xyz ); // inverse-transpose → monde
  vScanH = dot( wp.xyz - uScanOrigin, uScanAxis ) / uScanHeight;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

// ---------------------------------------------------------------------------------------------------------
// PB_Glass
// ---------------------------------------------------------------------------------------------------------
export const PB_GLASS_FRAGMENT = /* glsl */`
uniform mat4 modelMatrix;
${SHARED}
uniform sampler2D uMasks;      // R satin, G dry-time, B cavité derrière, A facette (chargé flipY = false)
// A est stocké en 128..255 (facette 0..1) : WebKit (iPhone, tous navigateurs) stocke les images prémultipliées et
// efface le RGB des pixels d'alpha 0 — la cavité (B) vivait sous alpha 0, le verre ne voyait plus le jus sur téléphone
float pbFacet( float a ) { return clamp( ( a * 255.0 - 128.0 ) / 127.0, 0.0, 1.0 ); }
uniform float uDryT;           // front de séchage : < 0 tout mouillé, > 1.3 tout sec
uniform float uSheet;          // nappe d'eau qui ruisselle à la sortie
uniform vec4 uShock;           // x, y (local, m), t (s depuis la frappe, < 0 éteint), amplitude
uniform float uSigmaB;         // opacité d'épaisseur par mm
uniform vec3 uGlassAbs;        // teinte aqua : absorption par mm
uniform float uKR;             // poids du corps réfracté (corps)
uniform float uKRFacet;        // idem sur les facettes
uniform float uSatinAlpha;
uniform float uSatinScatter;
uniform float uF0;
uniform float uTirK;
uniform float uGlintK;
uniform vec3 uCavC;            // centre de la cavité (local) : sert à reconnaître les parois internes
uniform float uCavHalfDepth;
uniform vec3 uJuiceTone;       // couleur moyenne du jus vu de face (vitrine), pour le satin posé dessus
uniform float uInnerK;         // poids de la réflexion interne (facettes, flancs)
uniform float uEdgeK;          // bord sombre sarcelle
uniform float uCreaseK;        // liseré des arêtes de facette
uniform float uCharge;         // partagés avec le jus (soleil ambré) : la bande satinée suit la couleur du jus
uniform float uFloorY;
uniform float uFillY;
uniform float uDebug;          // 1 : sortie des masques (jus derrière, B au point sondé, satin)
varying vec3 vPw;
varying vec3 vNw;
varying vec3 vPl;
varying vec3 vNl;
varying vec2 vPbUv;
varying vec2 vPbUv1;
varying float vScanH;

float pbRivulets( vec2 p, float t ) {
  // filets irréguliers : tête plus large en bas, queue effilée, longueurs et vitesses propres à chaque colonne
  float cw = 0.0026;
  float col = floor( p.x / cw );
  float r1 = pbHash( vec2( col, 1.7 ) ), r2 = pbHash( vec2( col, 9.1 ) ), r3 = pbHash( vec2( col, 4.3 ) );
  float fx = fract( p.x / cw ) - 0.5 + ( r1 - 0.5 ) * 0.5;
  float seg = fract( ( p.y + t * ( 0.018 + 0.03 * r2 ) ) / ( 0.018 + 0.024 * r3 ) + r1 * 7.0 );
  float len = 0.3 + 0.45 * r2;
  float body = smoothstep( 0.0, 0.05, seg ) * ( 1.0 - smoothstep( len * 0.25, len, seg ) );
  float width = mix( 0.2, 0.06, clamp( seg / len, 0.0, 1.0 ) );
  float wx = 1.0 - smoothstep( width * 0.35, width, abs( fx ) );
  float head = ( 1.0 - smoothstep( 0.0, 0.07, seg ) ) * ( 1.0 - smoothstep( 0.08, 0.26, abs( fx ) ) );
  return ( wx * body * 0.6 + head ) * step( 0.5, r2 );
}

void main() {
  if ( vScanH > uReveal ) discard;
  vec3 Pg = pbToGarden( vPw );
  if ( uClip > 0.5 && Pg.y < uWaterY && Pg.x > uPool.x && Pg.x < uPool.y && Pg.z > uPool.z && Pg.z < uPool.w ) discard;

  vec3 V = normalize( cameraPosition - vPw );
  vec3 N = normalize( vNw );
  vec4 msk = texture2D( uMasks, vec2( vPbUv.x, 1.0 - vPbUv.y ) );
  float inner = step( dot( vNl, vPl - uCavC ), 0.0 );         // parois de la cavité (normales vers l'intérieur)
  float faceZ = smoothstep( 0.55, 0.8, abs( vNl.z ) );        // faces avant / arrière (pas les flancs)
  float h = clamp( vPl.y / 0.09, 0.0, 1.0 );

  // ---- onde de choc de la frappe : anneau radial qui perturbe la normale de la face ----------------
  if ( uShock.z >= 0.0 && uShock.z < 0.6 ) {
    vec2 d = vPl.xy - uShock.xy;
    float r = length( d );
    float x = ( r - uShock.z * 0.15 ) / 0.005;
    float wv = sin( x * 2.2 ) * exp( -x * x * 0.5 ) * uShock.w * ( 1.0 - uShock.z / 0.6 ) * faceZ;
    vec3 tw = normalize( mat3( modelMatrix ) * vec3( d / max( r, 1e-4 ), 0.0 ) );
    N = normalize( N + tw * wv * 0.45 );
  }

  // ---- sec / mouillé ------------------------------------------------------------------------------------
  float dry = clamp( ( uDryT - mix( 1.0 - h, msk.g, 0.35 ) ) * 4.0, 0.0, 1.0 );
  float wet = 1.0 - dry;
  float satin = msk.r * dry * ( 1.0 - inner ) * faceZ;
  float sheet = 0.0, sheetEdge = 0.0;
  if ( uSheet > 0.001 ) {
    float e = Pg.y - uWaterY;
    float fing = 0.006 + 0.010 * ( 0.5 + 0.5 * sin( vPl.x * 1900.0 + pbHash( vec2( floor( vPl.x * 600.0 ), 3.0 ) ) * 6.28 ) );
    sheet = uSheet * step( 0.0, e ) * ( 1.0 - smoothstep( 0.0, 0.04, e ) );
    sheetEdge = uSheet * ( 1.0 - smoothstep( fing, fing + 0.004, e ) ) * smoothstep( fing - 0.004, fing, e ) * step( 0.0, e );
  }
  float riv = 0.0, spark = 0.0;
  if ( wet > 0.01 && ( 1.0 - inner ) > 0.5 ) {
    if ( uTier > 1.5 ) {
      riv = pbRivulets( vPl.xy, uTime ) * wet;
      vec3 tw = normalize( mat3( modelMatrix ) * vec3( 1.0, 0.0, 0.0 ) );
      N = normalize( N + tw * riv * 0.08 * sign( sin( vPl.x * 3000.0 ) ) );
    }
    vec2 cell = floor( vPl.xy / 0.0008 );
    float rn = pbHash( cell );
    spark = pow( rn, 12.0 ) * ( 0.55 + 0.45 * sin( uTime * 7.0 + rn * 40.0 ) ) * wet;
  }

  float NV = max( dot( N, V ), 0.0 );
  vec3 R = reflect( -V, N );
  float A = pbFacet( msk.a );
  float rough = mix( mix( 0.035, 0.02, wet ), 0.55, satin );
  float F = pbSchlick( uF0, NV ) * mix( 1.0, 1.3, A );
  F = min( 1.0, F + sheet * 0.08 );
  vec3 env = pbEnv( vPw, R, rough );

  // ---- reflets nets : clé (900) + contre-jour, plus doux sur le satin ---------------------------------
  float shin = mix( 900.0, 40.0, satin );
  vec3 glint = ( pow( max( dot( R, uKeyDir ), 0.0 ), shin ) * uKeyCol + pow( max( dot( R, uRimDir ), 0.0 ), shin * 0.6 ) * uRimCol * 0.6 )
             * uGlintK * mix( 1.0, 0.12, satin );
  glint += pow( max( dot( R, uKeyDir ), 0.0 ), 60.0 ) * uKeyCol * ( riv * 1.4 + spark * 3.0 + sheetEdge * 0.8 );
  // filets d'eau : un ruban plus brillant (l'eau épaissit le reflet), jamais un trait sombre
  glint += ( env * 0.16 + vec3( 0.01 ) ) * riv + env * sheetEdge * 0.6;

  vec3 rgb;
  float a;
  if ( inner > 0.5 ) {
    // paroi interne vue par la poche d'air : reflet faible + liseré (TIR de la cavité)
    float Fi = pbSchlick( 0.04, NV );
    float edgeI = pow( 1.0 - NV, 2.0 );
    vec3 envI = pbEnv( vPw, R, 0.08 );
    a = clamp( Fi * 0.7 + edgeI * 0.18, 0.0, 0.6 );
    rgb = ( envI * ( Fi * 0.7 + edgeI * 0.35 ) ) / max( a, 1e-3 );
    glint *= 0.35;
  } else {
    // ---- épaisseur : opacité et teinte aqua sur le trajet ------------------------------------------------
    float Lmm = vPbUv1.x * 50.0 / max( NV, 0.2 );
    float sigB = 1.0 - exp( -uSigmaB * Lmm );
    vec3 tint = exp( -uGlassAbs * Lmm );
    float edge = pow( 1.0 - NV, 3.0 );
    float envLum = mix( 0.45, 0.75, uOutside );   // luminance moyenne de la sonde / du studio (pas de lecture de texture)
    vec3 milk = vec3( uSatinScatter * envLum * 0.45 );

    // le jus est-il derrière ? on suit le rayon réfracté 6,5 mm dans le verre (marche aussi par les flancs)
    vec3 Vl = normalize( uCamLocal - vPl );
    vec3 Nl0 = normalize( vNl );
    vec3 Tl = refract( -Vl, Nl0, 1.0 / 1.5 );
    vec3 Q = vPl + Tl * ( 0.0065 / max( dot( Tl, -Nl0 ), 0.35 ) );
    float bQ = msk.b;                                // faces avant/arrière : Q.xy ≈ P.xy
    if ( faceZ < 0.99 ) bQ = textureLod( uMasks, vec2( ( Q.x + 0.035 ) / 0.070, 1.0 - Q.y / 0.090 ), 1.5 ).b;
    float juice = bQ * step( abs( Q.z ), uCavHalfDepth + 0.001 ) * ( 1.0 - smoothstep( -0.0008, 0.0008, dot( Q - uFillP, uFillN ) ) );

    // jus derrière : le verre ne pose que reflet, teinte, satin et mouillé. L'épaisseur est celle de la paroi
    // devant la cavité (analytique : uv1.x est interpolé depuis les sommets du contour, donc celle du bord plein)
    float wallMm = mix( 5.0, max( abs( vPl.z ) - uCavHalfDepth, 0.0005 ) * 1000.0, faceZ );
    float LmmJ = wallMm / max( NV, 0.2 );
    float sigJ = 1.0 - exp( -uSigmaB * LmmJ );
    vec3 tintJ = exp( -uGlassAbs * LmmJ );
    vec3 juiceTone = uJuiceTone * mix( 0.35, 1.0, uOutside );
    float kcG = clamp( uCharge * 2.2 * ( 1.0 - smoothstep( 0.0, 0.16, ( Q.y - uFloorY ) / max( uFillY - uFloorY, 1e-3 ) ) ), 0.0, 1.0 );
    juiceTone = mix( juiceTone, vec3( 1.0, 0.72, 0.35 ) * ( 0.55 + 0.35 * kcG ), kcG * 0.85 );
    float abJ = max( sigJ, satin * uSatinAlpha );
    vec3 bodyJ = mix( juiceTone * tintJ, juiceTone * 1.08 + milk, clamp( satin * uSatinAlpha / max( abJ, 1e-3 ), 0.0, 1.0 ) );

    // ailleurs : branche réfraction (parois, facettes, base, poche d'air) ; le satin floute le fond
    float wPost, airQ = 0.0;
    vec3 Tr = refract( -V, N, 1.0 / 1.5 );
    vec3 bg = pbBackdrop( vPw, Tr, mix( 1.0, 4.5, satin ), wPost );
    if ( uScreenK > 0.001 ) {
      // fond réel copié : la cour 3D, les koï, les fleurs et l'image caméra vus à travers le cristal
      float wS;
      vec3 sb = pbScreen( vPw, Tr, 0.03 * length( modelMatrix[ 0 ].xyz ), satin * 0.006 * uScreenPx.y, wS );
      // poche d'air derrière (col ouvert vu d'en haut) : la copie précède le jus, elle montrerait le jardin à la place
      // de la surface du jus → on laisse transparaître le tampon (surface du jus déjà dessinée)
      airQ = bQ * step( abs( Q.z ), uCavHalfDepth + 0.001 ) * ( 1.0 - juice );
      float kS = uScreenK * wS * ( 1.0 - airQ );
      bg = mix( bg, sb, kS );
      wPost = mix( wPost, 1.0, kS );   // le fond est le vrai : plus besoin de laisser transparaître la caméra
    }
    if ( uTier > 1.5 ) {
      // réflexion interne sur la face opposée : 4 % ou réflexion totale au-delà de l'angle critique
      // face de sortie : la face parallèle opposée (−N), ou la grande face arrière pour une facette
      vec3 nbl = mix( -Nl0, vec3( 0.0, 0.0, -sign( vPl.z ) ), step( 0.5, A ) * faceZ );
      vec3 nb = normalize( mat3( modelMatrix ) * nbl );
      float ci = abs( dot( Tr, nb ) );
      float kI = ci < 0.745 ? 1.0 : pbSchlick( 0.04, ci );
      vec3 Ti = reflect( Tr, nb );
      bg = mix( bg, pbEnv( vPw, Ti, 0.1 ), kI * uInnerK * ( 1.0 - satin ) );
    }
    float kR = mix( uKR, uKRFacet, A );
    kR = mix( 0.25, kR, wPost );
    kR = mix( kR, 0.25, airQ * uScreenK );
    float abR = max( kR, satin * uSatinAlpha );
    vec3 bodyR = mix( bg * tint, bg * tint * 1.06 + milk, clamp( satin * uSatinAlpha / max( abR, 1e-3 ), 0.0, 1.0 ) );

    if ( uDebug > 0.5 ) { gl_FragColor = vec4( juice, bQ, satin, 1.0 ); return; }
    float ab = mix( abR, abJ, juice );
    vec3 body = mix( bodyR, bodyJ, juice );
    // bord sombre sarcelle (épaisseur vue en biais) puis contour TIR lumineux
    body = mix( body, body * vec3( 0.30, 0.58, 0.56 ), edge * uEdgeK );
    ab = max( ab, edge * 0.85 * uEdgeK );
    vec3 tir = env * smoothstep( 0.75, 0.95, 1.0 - NV ) * uTirK;
    // arêtes vives du cristal : liseré clair (1-2 px) à la frontière facette / table, plus sombre côté facette
    float crease = clamp( fwidth( A ) * 1.6, 0.0, 1.0 ) * faceZ;
    tir += crease * ( env * 0.9 + vec3( 0.10 ) ) * uCreaseK;
    if ( uTier > 1.5 ) {
      // arête de la facette ARRIÈRE vue à travers le bord plein : second liseré décalé par la parallaxe (épaisseur)
      vec3 Pb = vPl + Tl * ( ( abs( vPl.z ) + 0.017 ) / max( abs( Tl.z ), 0.25 ) );
      float Ab = pbFacet( textureLod( uMasks, vec2( ( Pb.x + 0.035 ) / 0.070, 1.0 - Pb.y / 0.090 ), 0.0 ).a );
      float crease2 = clamp( fwidth( Ab ) * 1.4, 0.0, 1.0 ) * faceZ * ( 1.0 - juice ) * ( 1.0 - inner );
      tir += crease2 * ( env * 0.6 + vec3( 0.06 ) ) * uCreaseK;
      body *= 1.0 - crease2 * 0.3;
    }
    body *= 1.0 - crease * 0.25;
    a = clamp( F + ( 1.0 - F ) * ab, 0.0, 1.0 );
    rgb = ( F * env + ( 1.0 - F ) * ab * body + tir ) / max( a, 1e-3 );
  }

  // révélation (balayage depuis la base)
  float rBand = exp( -pbSq( ( vScanH - uReveal ) * 28.0 ) ) * step( uReveal, 1.2 );
  glint += uBandColor * rBand;

  gl_FragColor = vec4( rgb, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb *= gl_FragColor.a;                    // prémultiplié après le tone mapping
  gl_FragColor.rgb += pbToneMap( glint );                 // reflets additifs (clippent au blanc)
}
`

// ---------------------------------------------------------------------------------------------------------
// PB_Juice
// ---------------------------------------------------------------------------------------------------------
export const PB_JUICE_FRAGMENT = /* glsl */`
uniform mat4 modelMatrix;
${SHARED}
uniform sampler2D uRosette;
uniform vec3 uSigma;           // cm⁻¹
uniform float uHalfDepth;      // demi-profondeur de la cavité (m)
uniform float uFloorY;
uniform float uFillY;          // hauteur du ménisque au repos (m) : normalise la charge ambrée
uniform float uCharge;
uniform vec4 uRing;            // ride de frappe : x, z (local), t, amplitude
uniform float uMenW;           // demi-largeur du trait de ménisque (m)
uniform vec3 uInScatter;
uniform float uInScatterK;
uniform float uRosetteK;
uniform float uScreenLumaK;    // part de luminance du fond réel vu à travers le jus (lisibilité du jardin)
varying vec3 vPw;
varying vec3 vNw;
varying vec3 vPl;
varying vec3 vNl;
varying vec2 vPbUv;
varying vec2 vPbUv1;
varying float vScanH;

void main() {
  if ( vScanH > uReveal ) discard;
  float dPl = dot( vPl - uFillP, uFillN );
  if ( dPl > 0.0 ) discard;                                  // au-dessus du plan de remplissage : air
  vec3 V = normalize( cameraPosition - vPw );
  vec3 col;
  vec3 glow = uGlow * uInScatter * 1.6;

  if ( gl_FrontFacing ) {
    vec3 N = normalize( vNw );
    float NV = max( dot( N, V ), 0.0 );
    float Lcm = vPbUv1.x * 5.0 / max( NV, 0.25 );
    // réfraction (n 1.36) jusqu'au plan arrière de la cavité : point de sortie Pe (parallaxe intérieure)
    vec3 Vl = normalize( uCamLocal - vPl );
    vec3 Vr = refract( -Vl, normalize( vNl ), 1.0 / 1.36 );
    vec3 Pe = vPl;
    if ( Vr.z < -1e-3 ) {
      Pe = vPl + Vr * max( ( -uHalfDepth - vPl.z ) / Vr.z, 0.0 );
      // sur l'arrondi du bord, le rayon réfracté traverse toute la profondeur : pas de liseré clair parasite
      Lcm = max( Lcm, min( length( Pe - vPl ) * 100.0, 6.0 ) * 0.85 );
    }
    vec3 T = exp( -uSigma * Lcm );
    vec3 Pew = ( modelMatrix * vec4( Pe, 1.0 ) ).xyz;
    vec3 Vrw = normalize( mat3( modelMatrix ) * Vr );
    float w;
    vec3 bg = pbBackdrop( Pew, Vrw, 2.0, w );
    if ( uScreenK > 0.001 ) {
      float wS;
      vec3 sb = pbScreen( Pew, Vrw, 0.025 * length( modelMatrix[ 0 ].xyz ), 0.0012 * uScreenPx.y, wS );
      // le cobalt ne laisse passer que le bleu : zellige blanc / bleu Majorelle s'y confondent. On porte la luminance
      // du vrai fond dans tous les canaux pour que le jardin (plantes, koï, lotus) se lise à travers le jus.
      sb = mix( sb, vec3( dot( sb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), uScreenLumaK );
      bg = mix( bg, sb, uScreenK * wS );
    }
    vec2 ruv = uTier < 0.5 ? vPbUv : vec2( ( Pe.x + 0.035 ) / 0.070, Pe.y / 0.090 );
    float ros = texture2D( uRosette, ruv ).r;
    float envD = mix( 0.45, 0.75, uOutside );
    col = bg * T * ( 1.0 + uRosetteK * ros ) + ros * T * envD * uRosetteK * 0.6
        + uInScatter * uInScatterK * ( 1.0 - T )
        + pow( max( dot( -V, uKeyDir ), 0.0 ), 4.0 ) * ( 1.0 - T ) * 0.35 * uKeyCol;
    col += glow;
    float hN = clamp( ( vPl.y - uFloorY ) / max( uFillY - uFloorY, 1e-3 ), 0.0, 1.0 );
    // soleil ambré de la note de fond : il remplace le cobalt par le bas (un simple ajout virerait au lilas)
    // limité à une fine couche dorée au fond : un mélange cobalt/ambre sur toute la hauteur virait au lilas délavé
    float kc = clamp( uCharge * 2.2 * ( 1.0 - smoothstep( 0.0, 0.16, hN ) ), 0.0, 1.0 );
    col = mix( col, vec3( 1.0, 0.74, 0.32 ) * ( 0.75 + 0.45 * kc ), kc * 0.9 );
    // trait lumineux du ménisque (0,6 mm)
    float men = 1.0 - smoothstep( uMenW * 0.4, uMenW, abs( dPl ) );
    if ( men > 0.001 ) {
      vec3 envU = pbEnv( vPw, reflect( -V, normalize( mat3( modelMatrix ) * uFillN ) ), 0.15 );
      col += men * ( envU * 0.7 + vec3( 0.22, 0.26, 0.34 ) );
    }
  } else {
    // surface libre vue par le haut : on intersecte le rayon de vue avec le plan de remplissage
    vec3 Dl = vPl - uCamLocal;
    float den = dot( Dl, uFillN );
    float tt = abs( den ) > 1e-6 ? dot( uFillP - uCamLocal, uFillN ) / den : 1.0;
    vec3 S = uCamLocal + Dl * clamp( tt, 0.0, 1.0 );
    vec3 Nl = uFillN;
    if ( uRing.z >= 0.0 && uRing.z < 0.8 ) {
      vec3 q = S - uFillP; q -= dot( q, uFillN ) * uFillN;
      float r = length( q.xz - uRing.xy );
      float wv = sin( r * 2200.0 - uRing.z * 40.0 ) * exp( -uRing.z * 5.0 ) * exp( -r * 120.0 ) * uRing.w;
      vec3 rd = q / max( length( q ), 1e-5 );
      Nl = normalize( Nl + rd * wv * 0.35 );
    }
    vec3 N = normalize( mat3( modelMatrix ) * Nl );
    float NV = abs( dot( N, V ) );
    float F = pbSchlick( 0.02, NV );
    vec3 env = pbEnv( vPw, reflect( -V, N ), 0.04 );
    vec3 deep = vec3( 0.010, 0.028, 0.32 ) * ( 0.6 + 0.4 * mix( 0.6, 1.0, uOutside ) );
    col = mix( deep + glow, env, F );
    col += uCharge * vec3( 1.0, 0.72, 0.35 ) * 0.25;
    float rim = 1.0 - smoothstep( 0.0, 0.0016, -dPl );
    col += rim * ( 0.35 * env + vec3( 0.10, 0.14, 0.24 ) );
  }
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

// ---------------------------------------------------------------------------------------------------------
// PB_Gold / PB_Cap : patch onBeforeCompile d'un MeshPhysicalMaterial
// ---------------------------------------------------------------------------------------------------------
const GOLD_VERTEX_PARS = (flags) => /* glsl */`
#ifndef USE_UV1
attribute vec2 uv1;
#endif
${flags ? 'attribute vec4 aFlags;' : ''}
uniform vec3 uRingPivot;
uniform float uRingAngle;
uniform float uPump;
uniform float uPumpTravel;
uniform vec3 uScanOrigin;
uniform vec3 uScanAxis;
uniform float uScanHeight;
varying vec3 vPbW;
varying vec2 vPbUv1;
varying float vPbStrike;
varying float vScanH;
`

const GOLD_FRAGMENT_PARS = /* glsl */`
uniform mat4 uWorldToGarden;
uniform samplerCube uProbe;
uniform vec3 uProbePos;
uniform vec3 uRoomMin;
uniform vec3 uRoomMax;
uniform float uProbeGain;
uniform float uGardenMix;
uniform float uWaterY;
uniform float uGlow;
uniform float uStrikeFlash;
uniform float uChase;
uniform float uChaseK;
uniform float uAOK;
uniform float uSoftK;
uniform vec3 uKeyDir;
uniform vec3 uKeyCol;
uniform vec3 uRimDir;
uniform vec3 uRimCol;
uniform vec3 uWarmDir;
uniform vec3 uWarmCol;
uniform vec3 uSoftDir;
uniform vec3 uSoftCol;
uniform float uReveal;
uniform vec3 uBandColor;
varying vec3 vPbW;
varying vec2 vPbUv1;
varying float vPbStrike;
varying float vScanH;
vec3 pbSafeDir( vec3 d ) {
  return vec3( abs( d.x ) < 1e-4 ? 1e-4 : d.x, abs( d.y ) < 1e-4 ? 1e-4 : d.y, abs( d.z ) < 1e-4 ? 1e-4 : d.z );
}
vec3 pbProbeBox( vec3 Pg, vec3 Rg, float lod ) {
  vec3 R = pbSafeDir( Rg );
  vec3 tf = max( ( uRoomMin - Pg ) / R, ( uRoomMax - Pg ) / R );
  float t = max( min( min( tf.x, tf.y ), tf.z ), 0.0 );
  return textureLod( uProbe, Pg + Rg * t - uProbePos, lod ).rgb * uProbeGain;
}
`

/**
 * Patch du matériau or (SPEC §2.4-3). `flags` = true pour PB_Gold (attribut aFlags : r anneau, g poussoir, b clou de frappe),
 * false pour PB_Cap. `uniforms` = objet partagé (U du flacon + uniforms or).
 */
export function patchGoldMaterial(mat, uniforms, flags) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms)
    let vs = sh.vertexShader.replace('#include <common>', `#include <common>\n${GOLD_VERTEX_PARS(flags)}`)
    if (flags) {
      vs = vs
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          {
            float pbC = cos( uRingAngle ), pbS = sin( uRingAngle );
            vec3 rn = vec3( objectNormal.x, pbC * objectNormal.y - pbS * objectNormal.z, pbS * objectNormal.y + pbC * objectNormal.z );
            objectNormal = mix( objectNormal, rn, aFlags.r );
          }`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            float pbC = cos( uRingAngle ), pbS = sin( uRingAngle );
            vec3 q = transformed - uRingPivot;
            q = vec3( q.x, pbC * q.y - pbS * q.z, pbS * q.y + pbC * q.z ) + uRingPivot;
            transformed = mix( transformed, q, aFlags.r );
            transformed.y -= aFlags.g * uPump * uPumpTravel;
          }`)
    }
    vs = vs.replace('#include <project_vertex>', `#include <project_vertex>
      {
        vec4 pbW = modelMatrix * vec4( transformed, 1.0 );
        vPbW = pbW.xyz;
        vPbUv1 = uv1;
        vPbStrike = ${flags ? 'aFlags.b' : '0.0'};
        vScanH = dot( pbW.xyz - uScanOrigin, uScanAxis ) / uScanHeight;
      }`)
    sh.vertexShader = vs
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${GOLD_FRAGMENT_PARS}`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `if ( vScanH > uReveal ) discard;
        vec4 diffuseColor = vec4( diffuse, opacity );`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        {
          // la cour (sonde en boîte) remplace le studio d'autant que uGardenMix ; AO bakée sur l'indirect
          vec3 pbRw = inverseTransformDirection( reflect( -geometryViewDir, geometryNormal ), viewMatrix );
          vec3 pbPg = ( uWorldToGarden * vec4( vPbW, 1.0 ) ).xyz;
          vec3 pbRg = normalize( mat3( uWorldToGarden ) * pbRw );
          if ( uGardenMix > 0.001 ) radiance = mix( radiance, pbProbeBox( pbPg, pbRg, material.roughness * 7.0 ), uGardenMix );
          // boîtes à lumière analytiques (clé, contre-jour, carton chaud devant) : facettes franches comme au studio
          float pbSoft = uSoftK * ( 1.0 - 0.6 * uGardenMix );
          radiance += pbSoft * ( pow( max( dot( pbRw, uKeyDir ), 0.0 ), 18.0 ) * uKeyCol * 2.2
                    + pow( max( dot( pbRw, uRimDir ), 0.0 ), 18.0 ) * uRimCol * 1.6
                    + pow( max( dot( pbRw, uWarmDir ), 0.0 ), 5.0 ) * uWarmCol
                    + pow( max( dot( pbRw, uSoftDir ), 0.0 ), 8.0 ) * uSoftCol );
          float pbAO = mix( 1.0, clamp( vPbUv1.y, 0.0, 1.0 ), uAOK );
          radiance *= mix( 1.0, pbAO, 0.8 );
          iblIrradiance *= pbAO;
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vPbStrike * uStrikeFlash * vec3( 1.0, 0.82, 0.5 ) * 4.0;
        if ( vPbUv1.x >= 0.0 ) totalEmissiveRadiance += exp( -pow2( ( vPbUv1.x - uChase ) * 12.0 ) ) * uChaseK * diffuseColor.rgb * 3.0;
        if ( ( uWorldToGarden * vec4( vPbW, 1.0 ) ).y < uWaterY ) totalEmissiveRadiance += uGlow * 0.4 * diffuseColor.rgb;
        totalEmissiveRadiance += uBandColor * exp( -pow2( ( vScanH - uReveal ) * 28.0 ) ) * step( uReveal, 1.2 );`)
  }
  mat.customProgramCacheKey = () => (flags ? 'pb-gold-flags-v1' : 'pb-gold-cap-v1')
  return mat
}

// ---------------------------------------------------------------------------------------------------------
// StudGlints : étoiles additives (billboard en espace vue)
// ---------------------------------------------------------------------------------------------------------
export const PB_GLINT_VERTEX = /* glsl */`
attribute float aGlintK;
uniform float uGlintSize;
varying vec2 vGUv;
varying float vGK;
void main() {
  vGUv = uv;
  vGK = aGlintK;
  vec4 c = modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
  float s = length( modelMatrix[ 0 ].xyz ) * uGlintSize * ( 0.55 + 0.45 * aGlintK );
  vec4 mv = viewMatrix * c;
  float an = 0.35 + aGlintK * 0.25;
  vec2 p = vec2( position.x * cos( an ) - position.y * sin( an ), position.x * sin( an ) + position.y * cos( an ) );
  mv.xy += p * s;
  gl_Position = projectionMatrix * mv;
}
`
export const PB_GLINT_FRAGMENT = /* glsl */`
uniform sampler2D uStar;
uniform vec3 uGlintCol;
varying vec2 vGUv;
varying float vGK;
void main() {
  float a = texture2D( uStar, vGUv ).r * vGK;
  if ( a < 0.003 ) discard;
  gl_FragColor = vec4( uGlintCol * a, a );
}
`
