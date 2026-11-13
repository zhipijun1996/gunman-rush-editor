/** Planned origins are provisional, never an assertion of physical continuity. */
export const isPlannedRoom=room=>room.layout_status==='planned';
export function mapRooms(project,{region='',layer='world',roomId=null,showPlanned=false}={}){
 return Object.values(project.rooms).filter(room=>(!region||room.region===region)&&room.layer===layer&&(!roomId||room.id===roomId)&&(roomId||showPlanned||!isPlannedRoom(room)));
}
export function layoutSummary(project){const rooms=Object.values(project.rooms);return {calibrated:rooms.filter(r=>r.layout_status==='calibrated').length,planned:rooms.filter(isPlannedRoom).length,draft:rooms.filter(r=>!['calibrated','planned'].includes(r.layout_status)).length};}
