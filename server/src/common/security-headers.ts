export const contentSecurityPolicyDirectives = {
  // Camera previews and authenticated receipt downloads use local object URLs.
  imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
  // WhatsApp audio and video are downloaded with authorization and exposed to
  // native media players through URL.createObjectURL().
  mediaSrc: ["'self'", 'data:', 'blob:', 'https:'],
};
