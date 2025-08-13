export const path = {
  venue: (venueId: string) => `venues/${venueId}`,
  departments: (venueId: string) => `venues/${venueId}/departments`,
  department: (venueId: string, departmentId: string) =>
    `venues/${venueId}/departments/${departmentId}`,
  areas: (venueId: string, departmentId: string) =>
    `venues/${venueId}/departments/${departmentId}/areas`,
  area: (venueId: string, departmentId: string, areaId: string) =>
    `venues/${venueId}/departments/${departmentId}/areas/${areaId}`,
  items: (venueId: string, departmentId: string, areaId: string) =>
    `venues/${venueId}/departments/${departmentId}/areas/${areaId}/items`,
  item: (venueId: string, departmentId: string, areaId: string, itemId: string) =>
    `venues/${venueId}/departments/${departmentId}/areas/${areaId}/items/${itemId}`,
  areaStatus: (venueId: string, departmentId: string, areaId: string) =>
    `venues/${venueId}/departments/${departmentId}/areas/${areaId}/status/summary`,
};
